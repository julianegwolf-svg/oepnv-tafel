'use strict';
/*
 * Anmeldung wie in Home Assistant:
 *   POST /auth/login_flow            → Formular (username/password)
 *   POST /auth/login_flow/<flow_id>  → falsch: errors.base=invalid_auth; MFA: step_id "mfa"; richtig: create_entry + Code
 *   POST /auth/token                 → authorization_code / refresh_token / action=revoke
 * Access-Tokens sind signierte JWTs (wie HA) mit Ablaufzeit; Refresh-Tokens lassen sich widerrufen.
 * Passwörter und Tokens werden nie geloggt.
 */
const crypto = require('crypto');
const { hexId } = require('./werkzeuge');

function b64url(puffer) {
  return Buffer.from(puffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function gleichSicher(a, b) {
  const pa = Buffer.from(String(a));
  const pb = Buffer.from(String(b));
  if (pa.length !== pb.length) return false;
  return crypto.timingSafeEqual(pa, pb);
}

class Anmeldung {
  // optionen: { langzeitToken, konten: "name:pw[:mfa],…", ttlSekunden, log }
  constructor(optionen) {
    this.langzeitToken = optionen.langzeitToken;
    this.ttl = optionen.ttlSekunden || 1800;
    this.log = optionen.log || function () {};
    this.geheimnis = crypto.randomBytes(32);
    this.konten = new Map();
    String(optionen.konten || '').split(',').map(s => s.trim()).filter(Boolean).forEach(eintrag => {
      const teile = eintrag.split(':');
      if (teile.length >= 2) this.konten.set(teile[0], { name: teile[0], passwort: teile[1], mfa: teile[2] || null, id: hexId('benutzer-' + teile[0]) });
    });
    this.flows = new Map();          // flow_id → { client_id, redirect_uri, schritt, konto, erstellt }
    this.codes = new Map();          // code → { client_id, konto, erstellt }
    this.refreshTokens = new Map();  // token → { id, client_id, konto, widerrufen }
    this.refreshNachId = new Map();
    this.widerrufHoerer = new Set(); // fn(refreshId) – z. B. WebSocket-Verbindungen schließen
    this.besitzer = { id: hexId('benutzer-julian'), name: 'Julian', is_owner: true, is_admin: true };
  }

  // Alte Flows/Codes aufräumen (begrenzt den Speicher)
  aufraeumen() {
    const grenze = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of this.flows) if (v.erstellt < grenze) this.flows.delete(k);
    for (const [k, v] of this.codes) if (v.erstellt < grenze) this.codes.delete(k);
    if (this.refreshTokens.size > 500) {
      for (const [k, v] of this.refreshTokens) {
        if (v.widerrufen) { this.refreshTokens.delete(k); this.refreshNachId.delete(v.id); }
      }
    }
  }

  formular(flowId, schritt, fehler) {
    const istMfa = schritt === 'mfa';
    return {
      type: 'form',
      flow_id: flowId,
      handler: ['homeassistant', null],
      step_id: schritt,
      data_schema: istMfa
        ? [{ type: 'string', name: 'code', required: true }]
        : [{ type: 'string', name: 'username', required: true }, { type: 'string', name: 'password', required: true }],
      errors: fehler || {},
      description_placeholders: istMfa ? { mfa_module_name: 'Authenticator app', mfa_module_id: 'totp' } : null,
      last_step: null,
      preview: null
    };
  }

  pruefeClient(clientId, redirectUri) {
    let c;
    try {
      c = new URL(clientId);
    } catch (err) {
      return false;
    }
    if (c.protocol !== 'http:' && c.protocol !== 'https:') return false;
    if (redirectUri === undefined) return true;
    try {
      const r = new URL(redirectUri);
      return r.origin === c.origin;
    } catch (err) {
      return false;
    }
  }

  // POST /auth/login_flow
  flowStarten(body) {
    if (!body || !Array.isArray(body.handler) || body.handler[0] !== 'homeassistant') return { status: 400, json: { message: 'Invalid handler specified' } };
    if (!this.pruefeClient(body.client_id, body.redirect_uri)) return { status: 400, json: { message: 'invalid client id or redirect uri' } };
    this.aufraeumen();
    const flowId = crypto.randomBytes(16).toString('hex');
    this.flows.set(flowId, { client_id: body.client_id, redirect_uri: body.redirect_uri, schritt: 'init', konto: null, erstellt: Date.now(), versuche: 0 });
    return { status: 200, json: this.formular(flowId, 'init') };
  }

  // POST /auth/login_flow/<flow_id>
  flowSchritt(flowId, body) {
    const flow = this.flows.get(flowId);
    if (!flow) return { status: 404, json: { message: 'Invalid flow specified' } };
    if (!body || body.client_id !== flow.client_id) return { status: 400, json: { message: 'Invalid client id' } };
    if (flow.schritt === 'init') {
      const konto = this.konten.get(String(body.username || '').trim());
      if (!konto || !gleichSicher(konto.passwort, body.password || '')) {
        flow.versuche++;
        this.log('Anmeldung: falsche Zugangsdaten');
        if (flow.versuche >= 5) {
          this.flows.delete(flowId);
          return { status: 200, json: { type: 'abort', flow_id: flowId, handler: ['homeassistant', null], reason: 'login_attempt_failed', description_placeholders: null } };
        }
        return { status: 200, json: this.formular(flowId, 'init', { base: 'invalid_auth' }) };
      }
      flow.konto = konto;
      if (konto.mfa) {
        flow.schritt = 'mfa';
        return { status: 200, json: this.formular(flowId, 'mfa') };
      }
      return { status: 200, json: this.abschliessen(flowId, flow) };
    }
    if (flow.schritt === 'mfa') {
      if (!gleichSicher(flow.konto.mfa, String(body.code || ''))) {
        flow.versuche++;
        this.log('Anmeldung: falscher MFA-Code');
        if (flow.versuche >= 5) {
          this.flows.delete(flowId);
          return { status: 200, json: { type: 'abort', flow_id: flowId, handler: ['homeassistant', null], reason: 'too_many_retry', description_placeholders: null } };
        }
        return { status: 200, json: this.formular(flowId, 'mfa', { base: 'invalid_code' }) };
      }
      return { status: 200, json: this.abschliessen(flowId, flow) };
    }
    return { status: 400, json: { message: 'Invalid flow state' } };
  }

  flowAbbrechen(flowId) {
    if (!this.flows.delete(flowId)) return { status: 404, json: { message: 'Invalid flow specified' } };
    return { status: 200, json: { message: 'Flow aborted' } };
  }

  abschliessen(flowId, flow) {
    this.flows.delete(flowId);
    const code = crypto.randomBytes(16).toString('hex');
    this.codes.set(code, { client_id: flow.client_id, konto: flow.konto, erstellt: Date.now() });
    this.log('Anmeldung erfolgreich: ' + flow.konto.name);
    return {
      type: 'create_entry', flow_id: flowId, handler: ['homeassistant', null], title: flow.konto.name,
      description: null, description_placeholders: null, result: code, version: 1, minor_version: 1, context: { source: 'user' }
    };
  }

  accessToken(refresh) {
    const jetztS = Math.floor(Date.now() / 1000);
    const kopf = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const inhalt = b64url(JSON.stringify({ iss: refresh.id, iat: jetztS, exp: jetztS + this.ttl }));
    const signatur = b64url(crypto.createHmac('sha256', this.geheimnis).update(kopf + '.' + inhalt).digest());
    return kopf + '.' + inhalt + '.' + signatur;
  }

  // POST /auth/token (Formular-Felder)
  token(f) {
    if (f.action === 'revoke') {
      const r = this.refreshTokens.get(f.token || '');
      if (r && !r.widerrufen) this.widerrufe(r);
      return { status: 200, json: null };
    }
    if (f.grant_type === 'authorization_code') {
      const eintrag = this.codes.get(f.code || '');
      if (!eintrag || eintrag.client_id !== f.client_id) return { status: 400, json: { error: 'invalid_request', error_description: 'Invalid code' } };
      this.codes.delete(f.code);
      if (Date.now() - eintrag.erstellt > 10 * 60 * 1000) return { status: 400, json: { error: 'invalid_request', error_description: 'Invalid code' } };
      const token = crypto.randomBytes(64).toString('hex');
      const r = { id: crypto.randomBytes(16).toString('hex'), client_id: f.client_id, konto: eintrag.konto, widerrufen: false, token: token };
      this.refreshTokens.set(token, r);
      this.refreshNachId.set(r.id, r);
      return { status: 200, json: { access_token: this.accessToken(r), token_type: 'Bearer', refresh_token: token, expires_in: this.ttl, ha_auth_provider: 'homeassistant' } };
    }
    if (f.grant_type === 'refresh_token') {
      const r = this.refreshTokens.get(f.refresh_token || '');
      if (!r || r.widerrufen) return { status: 400, json: { error: 'invalid_grant' } };
      if (f.client_id !== r.client_id) return { status: 400, json: { error: 'invalid_request', error_description: 'Invalid client id' } };
      return { status: 200, json: { access_token: this.accessToken(r), token_type: 'Bearer', expires_in: this.ttl, ha_auth_provider: 'homeassistant' } };
    }
    return { status: 400, json: { error: 'unsupported_grant_type' } };
  }

  widerrufe(r) {
    r.widerrufen = true;
    for (const fn of Array.from(this.widerrufHoerer)) {
      try {
        fn(r.id);
      } catch (err) {
        console.error('[auth] Widerruf-Hörer:', err);
      }
    }
  }

  alleWiderrufen() {
    let n = 0;
    for (const r of this.refreshTokens.values()) {
      if (!r.widerrufen) {
        this.widerrufe(r);
        n++;
      }
    }
    return n;
  }

  /*
   * Token prüfen (WebSocket-auth und Bearer). Rückgabe: { benutzer, refreshId } oder null.
   * Gültig: der feste Langzeit-Token oder ein nicht abgelaufenes Access-Token eines nicht widerrufenen Refresh-Tokens.
   */
  pruefe(token) {
    if (typeof token !== 'string' || !token) return null;
    if (this.langzeitToken && gleichSicher(token, this.langzeitToken)) return { benutzer: this.besitzer, refreshId: null };
    const teile = token.split('.');
    if (teile.length !== 3) return null;
    const erwartet = b64url(crypto.createHmac('sha256', this.geheimnis).update(teile[0] + '.' + teile[1]).digest());
    if (!gleichSicher(erwartet, teile[2])) return null;
    let inhalt;
    try {
      inhalt = JSON.parse(Buffer.from(teile[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    } catch (err) {
      return null;
    }
    if (!inhalt || typeof inhalt.exp !== 'number' || inhalt.exp <= Date.now() / 1000) return null;
    const r = this.refreshNachId.get(inhalt.iss);
    if (!r || r.widerrufen) return null;
    return { benutzer: { id: r.konto.id, name: r.konto.name, is_owner: false, is_admin: true }, refreshId: r.id };
  }
}

module.exports = { Anmeldung, gleichSicher };
