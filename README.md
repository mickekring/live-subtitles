# Live Subtitles - Realtidsundertexter för svenska

Ett verktyg för att skapa realtidsundertexter från svenskt tal, med möjlighet till översättning till andra språk.

## Funktioner

- **Realtidstranskribering** av svenskt tal med KB Whisper-modeller
- **Flera modellstorlekar** att välja mellan (Tiny, Base, Small, Medium, Large)
- **Översättning** till flera språk via Ollama (lokal AI)
- **Experimentell snabbläge** för omedelbar textvisning
- **Enkel installation** och användning

## Systemkrav

- macOS, Windows eller Linux
- Python 3.8 eller senare
- Node.js 18 eller senare
- Mikrofon
- Minst 4GB RAM (8GB rekommenderat för större modeller)

## Installation

### Steg 1: Ladda ner projektet

```bash
git clone https://github.com/[ditt-användarnamn]/live-subtitles.git
cd live-subtitles
```

### Steg 2: Installera Backend (Python)

```bash
cd backend

# Skapa virtuell miljö
python3 -m venv venv

# Aktivera virtuell miljö
# På macOS/Linux:
source venv/bin/activate
# På Windows:
venv\Scripts\activate

# Installera beroenden
pip install -r requirements.txt

# Starta backend-servern
python main.py
```

Backend körs nu på http://localhost:8000

### Steg 3: Installera Frontend (i ett nytt terminalfönster)

```bash
cd frontend

# Installera beroenden
npm install

# Starta utvecklingsservern
npm run dev
```

Frontend körs nu på http://localhost:3000

### Steg 4: Öppna webbläsaren

Gå till http://localhost:3000 i din webbläsare (Chrome eller Edge rekommenderas).

## Användning

1. **Tillåt mikrofon**: När sidan öppnas, tillåt webbläsaren att använda din mikrofon
2. **Välj modell**: Klicka på kugghjulet för att välja AI-modell (Small är standard)
3. **Börja tala**: Klicka på "Starta" för att börja transkribera
4. **Se resultatet**: Texten visas i realtid på skärmen

### Modeller

- **Tiny (80 MB)**: Snabbast, lägst kvalitet
- **Base (150 MB)**: Snabb, acceptabel kvalitet
- **Small (500 MB)**: Balanserad hastighet och kvalitet (rekommenderas)
- **Medium (1.5 GB)**: Bättre kvalitet, långsammare
- **Large (3 GB)**: Bäst kvalitet, kräver mer minne

Modellerna laddas ner automatiskt första gången de används.

### Översättning (valfritt)

För att aktivera översättning behöver du Ollama installerat:

1. Installera Ollama från https://ollama.com
2. Ladda ner en språkmodell:
   ```bash
   ollama pull llama3.2:3b
   ```
3. Aktivera översättning i inställningarna och välj målspråk

## Felsökning

### Problem: "Mikrofon fungerar inte"
- Kontrollera att mikrofonen är ansluten
- Tillåt mikrofon i webbläsarens inställningar
- Testa i Chrome eller Edge

### Problem: "Backend startar inte"
- Kontrollera att Python 3.8+ är installerat: `python3 --version`
- Kontrollera att alla beroenden är installerade
- Se till att port 8000 inte används av annat program

### Problem: "Frontend startar inte"
- Kontrollera att Node.js 18+ är installerat: `node --version`
- Radera `node_modules` och kör `npm install` igen
- Se till att port 3000 inte används av annat program

### Problem: "Modellen laddas inte ner"
- Kontrollera internetanslutningen
- Vänta, större modeller kan ta tid att ladda ner
- Kontrollera att det finns tillräckligt med diskutrymme

## Avancerade inställningar

### VAD-känslighet
Justera Voice Activity Detection för att filtrera bort bakgrundsljud:
- Låg (1-2): Känsligare, plockar upp mer ljud
- Medium (3-4): Balanserad
- Hög (5): Striktare, filtrerar bort mer bakgrundsljud

### Experimentell snabbtranskribering
Aktivera för att se ord direkt när de uttalas (kan innehålla fel som korrigeras).

## Teknisk information

- **Backend**: FastAPI med faster-whisper
- **Frontend**: Next.js 15 med TypeScript
- **AI-modeller**: KB Whisper (svenskoptimerade Whisper-modeller från KBLab)
- **Realtidskommunikation**: WebSocket
- **Ljudbearbetning**: Web Audio API med AudioWorklet

## Licens

[Din licens här]

## Bidra

Pull requests välkomnas! För större ändringar, öppna först ett issue för att diskutera vad du vill ändra.

## Support

Skapa ett issue på GitHub om du stöter på problem eller har förslag på förbättringar.