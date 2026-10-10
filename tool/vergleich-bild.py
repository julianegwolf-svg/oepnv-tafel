# Vorher/Nachher nebeneinander (für MORGEN.html und Belege).
#   python3 -I tool/vergleich-bild.py ziel.png "Titel links" links.png "Titel rechts" rechts.png [skala]
import sys
from PIL import Image, ImageDraw, ImageFont

ziel, tl, l, tr, r = sys.argv[1:6]
skala = float(sys.argv[6]) if len(sys.argv) > 6 else 0.5
a, b = Image.open(l).convert("RGB"), Image.open(r).convert("RGB")
a = a.resize((int(a.width * skala), int(a.height * skala)))
b = b.resize((int(b.width * skala), int(b.height * skala)))
kopf, rand = 34, 12
out = Image.new("RGB", (a.width + b.width + 3 * rand, max(a.height, b.height) + kopf + rand), (18, 20, 26))
d = ImageDraw.Draw(out)
try:
    f = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
except Exception:
    f = ImageFont.load_default()
d.text((rand, 8), tl, fill=(240, 160, 75), font=f)
d.text((2 * rand + a.width, 8), tr, fill=(120, 210, 150), font=f)
out.paste(a, (rand, kopf))
out.paste(b, (2 * rand + a.width, kopf))
out.save(ziel)
