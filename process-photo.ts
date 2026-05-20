// api/process-photo.ts
// Receives an image + item type from the iOS Shortcut, runs it through
// Gemini 2.5 Flash Image with the matching catalog prompt, returns the
// processed image as base64.

import type { VercelRequest, VercelResponse } from "@vercel/node";

// ---- Prompts -------------------------------------------------------------

const SHARED_RULES = `
CRITICAL RULES — DO NOT:
- Alter the item's color, even subtly
- Change the fabric/material texture, pattern, or print
- Modify the fit, length, or proportions
- Add or remove any details (buttons, stitching, tags, trim, prints, pockets, laces, hardware)
- Smooth, retouch, or "improve" the texture
- Reinvent or guess at pattern details — preserve the original exactly, including stripe count, floral placement, plaid alignment, and graphic positioning
- Add a mannequin, hanger, model, foot, leg, or any other object to the final image

Background: pure white seamless (#FFFFFF) — no texture, no gradient, no color cast.
Lighting: soft, even, diffused studio light. No harsh shadows.
Shadow: add a subtle, soft grounding shadow directly beneath the item for natural depth.
Color-correct the item to true-to-life only if the original has an obvious color cast from poor lighting.
`;

const PROMPTS: Record<string, string> = {
  top: `You are processing a product photo for an online clothing boutique. The garment must remain 100% faithful to the original — this is a real product a customer will receive.

SUBJECT: The top (shirt, blouse, sweater, tee, tank, cardigan, jacket, etc.) is the only product being photographed. Remove all other clothing items (pants, shorts, skirts, shoes, belts, hats, scarves, bags, jewelry, accessories). Remove any mannequin, hanger, model, or person. Only the top should remain.

TASK:
1. Isolate the top as described above.
2. Convert the image into a FLAT LAY presentation regardless of how it was originally photographed (hanger, mannequin, model, or already flat).
3. Present the top from a directly overhead (top-down) viewpoint, laid flat and symmetrical.
4. Lay it out neatly: centered, symmetrical (left/right mirror), sleeves slightly extended outward, hem flat and even, neckline visible and naturally shaped, no wrinkles or bunching from previous display.

${SHARED_RULES}
OUTPUT: A clean overhead flat-lay catalog product photo on pure white, suitable for a Shopify listing.`,

  jeans: `You are processing a product photo for an online clothing boutique. The garment must remain 100% faithful to the original — this is a real product a customer will receive.

SUBJECT: The bottoms (jeans, pants, shorts, leggings, skirt) are the only product being photographed. Remove all other clothing items (tops, shoes, belts unless the belt is sold with the item, accessories). Remove any mannequin, hanger, model, or person. Only the bottoms should remain.

TASK:
1. Isolate the bottoms as described above.
2. Convert the image into a FLAT LAY presentation regardless of how it was originally photographed.
3. Present the bottoms from a directly overhead (top-down) viewpoint, laid flat and symmetrical.
4. Lay them out neatly: centered, legs together and straight (or very slightly tapered as the cut dictates), waistband flat and fully visible at the top, no wrinkles or bunching from previous display. Preserve the true rise, inseam length, and leg opening width.

${SHARED_RULES}
OUTPUT: A clean overhead flat-lay catalog product photo on pure white, suitable for a Shopify listing.`,

  shoes: `You are processing a product photo for an online footwear boutique. The shoe must remain 100% faithful to the original — this is a real product a customer will receive.

SUBJECT: The shoe/footwear (boot, sandal, sneaker, heel, flat, etc.) is the only product being photographed. Remove any foot, leg, mannequin, box, stand, or other object. If a matching pair is shown, keep both shoes; otherwise keep the single shoe.

TASK:
1. Isolate the footwear as described above.
2. Present it as a clean side-profile product shot (the standard footwear catalog angle), viewed from the outer/lateral side, toe pointing to the left, sitting level as if on an invisible flat surface. This is NOT a flat lay — it is a side-profile view.
3. If a pair is shown, place both shoes side by side at the same angle, slightly overlapping or staggered as is standard for catalog footwear, both toes pointing left.
4. Preserve the true silhouette, heel height, sole thickness, laces, buckles, straps, and all hardware exactly.

${SHARED_RULES}
OUTPUT: A clean side-profile catalog product photo on pure white, suitable for a Shopify listing.`,
};

// ---- Handler -------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Shared-secret check so only your shortcut can call this endpoint.
  const secret = req.headers["x-app-secret"];
  if (!secret || secret !== process.env.APP_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { image, itemType } = req.body as {
      image?: string;
      itemType?: string;
    };

    if (!image) {
      return res.status(400).json({ error: "Missing image" });
    }

    const type = (itemType || "top").toLowerCase();
    const prompt = PROMPTS[type];
    if (!prompt) {
      return res.status(400).json({
        error: `Unknown itemType "${type}". Use top, jeans, or shoes.`,
      });
    }

    // Strip a data URL prefix if the shortcut sends one.
    const base64 = image.includes(",") ? image.split(",")[1] : image;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: base64,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res
        .status(502)
        .json({ error: "Gemini request failed", detail: errText });
    }

    const data = await geminiRes.json();

    // Find the image part in the response.
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(
      (p: any) => p.inline_data?.data || p.inlineData?.data
    );
    const outImage =
      imagePart?.inline_data?.data || imagePart?.inlineData?.data;

    if (!outImage) {
      return res
        .status(502)
        .json({ error: "No image returned from Gemini", raw: data });
    }

    return res.status(200).json({ image: outImage });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: "Server error", detail: String(err?.message || err) });
  }
}
