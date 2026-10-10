// ---------------------------------------------------------------
// sprueche.js — deutsche Sprüche für das Panel "Spruch des Tages"
// (IDEEN S1). Lokal statt Advice Slip: deutsch, ohne Netz, ohne
// Tippfehler aus der Quelle. Nur gemeinfreie Autorinnen und Autoren
// (gestorben vor 1956) und Sprichwörter; Unsicheres ist als
// "zugeschrieben" markiert. Wortlaut nach dem Original (10.10.: sechs
// verbreitete Falschzitate korrigiert, z. B. Schiller "Was man von der
// Minute ausgeschlagen …", Nietzsche statt Frankls "Wer ein Warum …").
// Ergänzen: einfach Einträge anhängen.
// ---------------------------------------------------------------
const SPRUECHE = [
  { t: "Es ist nicht genug zu wissen, man muss auch anwenden; es ist nicht genug zu wollen, man muss auch tun.", a: "Johann Wolfgang von Goethe" },
  { t: "Wer immer strebend sich bemüht, den können wir erlösen.", a: "Johann Wolfgang von Goethe" },
  { t: "Das Was bedenke, mehr bedenke Wie.", a: "Johann Wolfgang von Goethe" },
  { t: "Getretner Quark wird breit, nicht stark.", a: "Johann Wolfgang von Goethe" },
  { t: "Edel sei der Mensch, hilfreich und gut.", a: "Johann Wolfgang von Goethe" },
  { t: "Mit dem Wissen wächst der Zweifel.", a: "Johann Wolfgang von Goethe" },
  { t: "Wer fremde Sprachen nicht kennt, weiß nichts von seiner eigenen.", a: "Johann Wolfgang von Goethe" },
  { t: "Die Axt im Haus erspart den Zimmermann.", a: "Friedrich Schiller" },
  { t: "Der Mensch ist nur da ganz Mensch, wo er spielt.", a: "Friedrich Schiller" },
  { t: "Was man von der Minute ausgeschlagen, gibt keine Ewigkeit zurück.", a: "Friedrich Schiller" },
  { t: "Früh übt sich, was ein Meister werden will.", a: "Friedrich Schiller" },
  { t: "Ich kann freilich nicht sagen, ob es besser werden wird, wenn es anders wird; aber so viel kann ich sagen, es muss anders werden, wenn es gut werden soll.", a: "Georg Christoph Lichtenberg" },
  { t: "Der Langsamste, der sein Ziel nur nicht aus den Augen verliert, geht noch immer geschwinder, als der ohne Ziel herumirrt.", a: "Gotthold Ephraim Lessing" },
  { t: "Habe Mut, dich deines eigenen Verstandes zu bedienen!", a: "Immanuel Kant" },
  { t: "Wer nichts weiß, muss alles glauben.", a: "Marie von Ebner-Eschenbach" },
  { t: "Der Klügere gibt nach! Eine traurige Wahrheit, sie begründet die Weltherrschaft der Dummheit.", a: "Marie von Ebner-Eschenbach" },
  { t: "Nicht weil es schwer ist, wagen wir es nicht, sondern weil wir es nicht wagen, ist es schwer.", a: "Seneca" },
  { t: "Es ist nicht wenig Zeit, die wir haben, sondern es ist viel Zeit, die wir nicht nutzen.", a: "Seneca" },
  { t: "Solange wir leben, lasst uns menschlich sein.", a: "Seneca" },
  { t: "Das Glück deines Lebens hängt von der Beschaffenheit deiner Gedanken ab.", a: "Marc Aurel" },
  { t: "Verliere nicht länger Zeit mit Gerede darüber, wie ein guter Mensch sein soll — sei einer.", a: "Marc Aurel" },
  { t: "Nichts ist so beständig wie der Wandel.", a: "Heraklit (zugeschrieben)" },
  { t: "Hat man sein Warum des Lebens, so verträgt man sich fast mit jedem Wie.", a: "Friedrich Nietzsche" },
  { t: "Ohne Musik wäre das Leben ein Irrtum.", a: "Friedrich Nietzsche" },
  { t: "Man muss noch Chaos in sich haben, um einen tanzenden Stern gebären zu können.", a: "Friedrich Nietzsche" },
  { t: "Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.", a: "Ludwig Wittgenstein" },
  { t: "Phantasie ist wichtiger als Wissen, denn Wissen ist begrenzt.", a: "Albert Einstein" },
  { t: "Beim Menschen ist es wie beim Velo. Nur wenn er fährt, kann er bequem die Balance halten.", a: "Albert Einstein" },
  { t: "Das Schönste, was wir erleben können, ist das Geheimnisvolle.", a: "Albert Einstein" },
  { t: "Wenn einer eine Reise tut, so kann er was erzählen.", a: "Sprichwort, nach Matthias Claudius" },
  { t: "Wo gehen wir denn hin? Immer nach Hause.", a: "Novalis" },
  { t: "Vater werden ist nicht schwer, Vater sein dagegen sehr.", a: "Wilhelm Busch" },
  { t: "Musik wird störend oft empfunden, dieweil sie mit Geräusch verbunden.", a: "Wilhelm Busch" },
  { t: "Wer vom Ziel nicht weiß, kann den Weg nicht haben.", a: "Christian Morgenstern" },
  { t: "Das Volk versteht das meiste falsch; aber es fühlt das meiste richtig.", a: "Kurt Tucholsky" },
  { t: "Humor ist der Knopf, der verhindert, dass uns der Kragen platzt.", a: "Joachim Ringelnatz (zugeschrieben)" },
  { t: "Humor ist, wenn man trotzdem lacht.", a: "Otto Julius Bierbaum" },
  { t: "Ein Optimist ist ein Mensch, der die Dinge nicht so tragisch nimmt, wie sie sind.", a: "Karl Valentin (zugeschrieben)" },
  { t: "Mögen hätt ich schon wollen, aber dürfen hab ich mich nicht getraut.", a: "Karl Valentin" },
  { t: "Heute ist die gute alte Zeit von morgen.", a: "Karl Valentin (zugeschrieben)" },
  { t: "Wer sich nicht bewegt, spürt seine Fesseln nicht.", a: "Rosa Luxemburg (zugeschrieben)" },
  { t: "Erst wägen, dann wagen.", a: "Helmuth von Moltke" },
  { t: "Es ist besser, ein einziges kleines Licht anzuzünden, als die Dunkelheit zu verfluchen.", a: "Konfuzius (zugeschrieben)" },
  { t: "Gut Ding will Weile haben.", a: "Sprichwort" },
  { t: "Morgenstund hat Gold im Mund.", a: "Sprichwort" },
  { t: "Wer rastet, der rostet.", a: "Sprichwort" },
  { t: "Kommt Zeit, kommt Rat.", a: "Sprichwort" },
  { t: "Übung macht den Meister.", a: "Sprichwort" },
  { t: "Wo ein Wille ist, ist auch ein Weg.", a: "Sprichwort" },
  { t: "Was du heute kannst besorgen, das verschiebe nicht auf morgen.", a: "Sprichwort" },
];
