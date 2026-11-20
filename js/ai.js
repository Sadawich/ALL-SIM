// Claude API from the browser. The key is the user's own and stays in their browser (localStorage).
const K = 'fllsim.ai';
export function aiSettings() {
  try { return { model: 'claude-sonnet-5-5', key: '', ...JSON.parse(localStorage.getItem(K) || '{}') }; } catch { return { model: 'claude-sonnet-5-5', key: '' }; }
}
export function saveAiSettings(s) { try { localStorage.setItem(K, JSON.stringify(s)); } catch { } }

const b64 = buf => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// source: { pdf?: ArrayBuffer, text?: string, name?: string }
export function ruleBlocks(source) {
  if (source.pdf && source.pdf.byteLength < 25e6) {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(source.pdf) }, title: source.name || 'Rules', cache_control: { type: 'ephemeral' } }];
  }
  const text = (source.text || '').split('\f').map((t, i) => `[page ${i + 1}]\n${t}`).join('\n\n').slice(0, 400000);
  return [{ type: 'text', text: `<rules name="${source.name || 'Rules'}">\n${text}\n</rules>`, cache_control: { type: 'ephemeral' } }];
}

export async function askClaude({ system, content, maxTokens = 2000 }) {
  const { key, model } = aiSettings();
  if (!key) throw new Error('Add your Anthropic API key in AI settings first.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `API error ${r.status}`);
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

export function parseJSON(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  return JSON.parse(m ? m[1] : text);
}

export const SETUP_SYSTEM = `You read robotics competition rulebooks and turn them into a simulator setup.
Reply with ONLY a JSON object, no prose:
{
  "name": string,                       // competition + season
  "field_width_mm": number|null,        // playing surface, longer side
  "field_height_mm": number|null,       // shorter side
  "match_time_s": number|null,
  "robot_max_mm": {"l": number|null, "w": number|null, "h": number|null},
  "start_zones": [{"name": string, "x_frac": number, "y_frac": number, "w_frac": number, "h_frac": number}],
  "scoring": [{"name": string, "points": number|null, "x_frac": number|null, "y_frac": number|null, "page": number|null}],
  "summary": string                     // 6-12 short bullet lines, most important rules for robot design and driving
}
Convert inches/cm/feet to mm. Fractions are positions on the field map: x_frac 0 = left edge, 1 = right edge; y_frac 0 = BOTTOM edge, 1 = top edge (as seen in the field image if one is provided). Use null when the rules or image don't say. Never invent numbers.`;

export const QA_SYSTEM = `You answer questions about a robotics competition rulebook for a student team.
Answer only from the rules provided. Quote at most a short phrase. Always cite page numbers like (p. 12).
If the rules don't cover it, say so. Keep answers short and practical.`;
