// chatbot.js — an AI assistant that answers buyer questions about a specific
// listing (price, stock, description) and can flag booking intent. Uses the
// Anthropic API directly from the server, so your API key never reaches the
// browser. Get a key at https://console.anthropic.com

const API_KEY = process.env.ANTHROPIC_API_KEY;

async function askAboutListing({ listing, business, history, message }) {
  if (!API_KEY) {
    return {
      reply: "The shopping assistant isn't configured yet — the site owner needs to add an ANTHROPIC_API_KEY.",
      wantsToBook: false,
    };
  }

  const system = `You are Swift Market's shopping assistant for one specific product listing.
Only discuss this product. Be concise and helpful, in a friendly, plain-spoken tone.

Product: ${listing.title}
Price: UGX ${listing.price}
Stock available: ${listing.stock_qty}
Description: ${listing.description || 'No further description provided.'}
Dealer: ${business.name} (${business.contact})

Rules:
- If stock is 0, tell the buyer it's out of stock and do not offer to book it.
- If the buyer clearly wants to book/order, confirm the quantity and price back to them,
  then end your reply with the exact line: [BOOKING_INTENT] on its own line, followed by
  the quantity as a number, e.g. "[BOOKING_INTENT] 2". Only do this once you've confirmed
  the buyer actually wants to proceed, not just asking questions.
- Never invent stock numbers, prices, or details not given above.`;

  const messages = [
    ...history.map(h => ({ role: h.sender === 'customer' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: message },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chatbot request failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('\n').trim();

  const bookingMatch = text.match(/\[BOOKING_INTENT\]\s*(\d+)/);
  const wantsToBook = !!bookingMatch;
  const quantity = bookingMatch ? Number(bookingMatch[1]) : null;
  const reply = text.replace(/\[BOOKING_INTENT\]\s*\d+/, '').trim();

  return { reply, wantsToBook, quantity };
}

module.exports = { askAboutListing };
