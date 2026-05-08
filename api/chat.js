import { readFile } from "node:fs/promises";
import path from "node:path";

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");

let knowledgeCache = null;

async function loadKnowledge() {
  if (knowledgeCache) return knowledgeCache;
  const [omWestander, tonalitet, konsulter, overrides, tipslistor] = await Promise.all([
    readFile(path.join(KNOWLEDGE_DIR, "om-westander.md"), "utf-8"),
    readFile(path.join(KNOWLEDGE_DIR, "tonalitet.md"), "utf-8"),
    readFile(path.join(KNOWLEDGE_DIR, "konsulter.md"), "utf-8"),
    readFile(path.join(KNOWLEDGE_DIR, "overrides.md"), "utf-8"),
    readFile(path.join(KNOWLEDGE_DIR, "tipslistor.md"), "utf-8"),
  ]);
  knowledgeCache = { omWestander, tonalitet, konsulter, overrides, tipslistor };
  return knowledgeCache;
}

const BEHAVIOR_INSTRUCTIONS = `Du är Westanders AI-assistent. Du svarar på svenska på frågor om PR, kommunikation, opinionsbildning, public affairs, kriskommunikation, varumärke, ledarskap, sociala medier, hållbarhet och övriga områden Westander jobbar med.

Format

Skriv aldrig markdown. Använd inga asterisker för fetstil (\`**\`), inga brädgårdar för rubriker (\`#\`, \`##\`), inga punktlistor med bindestreck eller stjärnor i början av rader. Skriv som ett naturligt samtal i ren prosa. Använd radbrytning mellan stycken. Om du behöver räkna upp saker, gör det i löpande text ("För det första... för det andra...") eller numrerat i prosan.

Tonalitet

Följ tonalitetsguiden under "Tonalitet" nedan i varje svar. Den är inte valfri — det är så Westander pratar.

Kunskap

Basera råd på Westanders tipslistor under "Tipslistor" nedan när frågan rör ett område som täcks av en lista. Citera korta passager naturligt om det stärker svaret ("Vårt första tips om kriskommunikation är att ta initiativet"). Lista inte upp alla tio punkter mekaniskt — välj de mest relevanta för just den här frågan.

För frågor om Westander som byrå (historik, värderingar, anställda, omsättning, tjänsteöversikt), använd "Om Westander" nedan.

Om frågan inte täcks av tipslistorna eller "Om Westander", svara baserat på allmän PR-kunskap men håll dig till Westanders tonalitet.

Hänvisning till konsulter

Varje tipslista har en ansvarig konsult som nämns i listans intro ("hör gärna av dig till X om du vill ha fler tips"). Denna ansvariga konsult är förstahandsval för kontakt — om inte en regel i "Override-regler" säger annat.

Tillämpa override-reglerna före listans ordinarie konsult. Om en fråga matchar en override-regel, hänvisa till den person som regeln pekar ut, inte till listans ansvariga.

Nämn konsult bara när det är naturligt och hjälpsamt — till exempel när användaren frågar efter mer info, vill bli kopplad vidare, eller har en konkret uppdrags-fråga. Nämn inte konsulten i varje svar; det blir påträngande. Om du nämner någon, gör det varmt och kort i prosan ("Vill du fördjupa dig är Maja Stridsberg den du ska prata med").

Vid otydlighet, eller om frågan inte matchar någon särskild konsult eller lista, hänvisa till info@westander.se eller växeln 08-464 96 50.

Ärlighet

Om du inte vet, säg det. Hitta inte på fakta om Westander, anställda eller tipslistor. Hänvisa hellre till info@westander.se.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").replace(/^﻿/, "").trim();
  if (!apiKey) return res.status(500).json({ error: "Konfigurationsfel. Kontakta administratören." });

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Ogiltig förfrågan." });

  try {
    const k = await loadKnowledge();

    const system = [
      { type: "text", text: BEHAVIOR_INSTRUCTIONS },
      { type: "text", text: `# Om Westander\n\n${k.omWestander}` },
      { type: "text", text: `# Tonalitet\n\n${k.tonalitet}` },
      { type: "text", text: `# Konsulter\n\n${k.konsulter}` },
      { type: "text", text: `# Override-regler\n\n${k.overrides}` },
      {
        type: "text",
        text: `# Tipslistor\n\n${k.tipslistor}`,
        cache_control: { type: "ephemeral" },
      },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system,
        messages: messages.slice(-10),
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("Anthropic API error:", response.status, errBody);
      return res.status(500).json({ error: "Tjänsten är tillfälligt otillgänglig. Försök igen." });
    }

    const data = await response.json();
    res.status(200).json({ reply: data.content[0].text });
  } catch (e) {
    console.error("Chat handler error:", e);
    res.status(500).json({ error: "Något gick fel. Försök igen." });
  }
}
