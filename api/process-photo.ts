// api/process-photo.ts
// Receives an image + item type from the iOS Shortcut, runs it through
// Gemini 2.5 Flash Image with the matching catalog prompt(s), and returns
// one or more processed images as base64.
//
// Tops produce TWO images (ghost mannequin + flat lay).
// Jeans and shoes produce ONE image each (clean overhead flat lay).

import type { VercelRequest, VercelResponse } from "@vercel/node";

// ---- Prompts -------------------------------------------------------------

const sharedRules = (framing: string) => `
FRAMING (critical for a consistent catalog):
- ${framing}
- Center the item horizontally and vertically.
- The item should fill approximately 80% of the frame, with even, balanced white margins on all sides.
- Use the SAME framing and scale for every item of this type so all product photos look uniform side by side in a catalog grid.

CRITICAL RULES — DO NOT:
- Alter the item's color, even subtly
- Change the fabric/material texture, pattern, or print
- Modify the fit, length, or proportions of the actual item
- Add or remove any details (buttons, stitching, tags, trim, prints, pockets, laces, hardware)
- Smooth, retouch, or "improve" the texture
- Reinvent or guess at pattern details — preserve the original exactly, including stripe count, stripe spacing, floral placement, plaid alignment, and graphic positioning

Background: pure white seamless (#FFFFFF) — no texture, no gradient, no color cast.
Lighting: soft, even, diffused studio light. No harsh shadows.
Shadow: add a subtle, soft grounding shadow directly beneath the item for natural depth.
Color-correct the item to true-to-life only if the original has an obvious color cast from poor lighting.
`;

const TOP_INTRO = `You are processing a product photo for an online WOMEN'S clothing boutique. The garment must remain 100% faithful to the original — this is a real product a customer will receive.

SUBJECT: The top (shirt, blouse, sweater, tee, tank, cardigan, jacket, etc.) is the only product being photographed. Remove all other clothing items (pants, shorts, skirts, shoes, belts, hats, scarves, bags, jewelry, accessories). Remove any mannequin, hanger, model, person, surface, or background clutter. Only the top should remain.`;

// Each item type maps to an ordered list of { style, prompt }.
// The Shortcut just sends the itemType; the server runs every style for it.
type StylePrompt = { style: string; prompt: string };

const PROMPTS: Record<string, StylePrompt[]> = {
  top: [
    {
      style: "ghost",
      prompt: `${TOP_INTRO}

TASK:
1. Isolate the top as described above.
2. Present the top as a "ghost mannequin" / invisible-mannequin product photo: the garment should look as though worn by an invisible WOMAN, viewed straight-on from the front.
3. Shape the garment to a feminine form — softly tapered waist, narrower shoulders, and the proportions of a women's dress form. It should clearly read as womenswear, NOT a broad, square, masculine torso.
4. Give it natural three-dimensional shape:
   - Gentle volume through the body so it isn't pressed flat
   - Soft, natural fabric folds and drape (not stiff, not heavily wrinkled)
   - The neckline open and rounded as it would sit on a body
   - Sleeves filled with subtle dimension, falling naturally at the sides or slightly outward
   - A soft hollow at the neckline showing the inside back collar, as is standard for ghost-mannequin shots
5. Keep the garment centered and symmetrical, with a clean, professional silhouette.

${sharedRules("Output a SQUARE image (1:1 aspect ratio).")}
OUTPUT: A clean ghost-mannequin catalog product photo on pure white, square format, suitable for a Shopify listing.`,
    },
  ],

  jeans: [
    {
      style: "cleanup",
      prompt: `You are lightly retouching a product photo for an online clothing boutique. This is a real product a customer will receive, so the jeans/bottoms must stay exactly as they appear in the original photo. This is a CLEANUP task, NOT a redraw — keep my actual photo and just improve it.

SUBJECT: The bottoms (jeans, pants, shorts, leggings, skirt) are the product. Keep them positioned and laid out exactly as in the original photo — do NOT rearrange, straighten, re-pose, or convert them to an idealized flat lay.

WHAT TO DO (light touch only):
1. Replace whatever is behind/around the bottoms with a clean, pure white seamless background (#FFFFFF). Remove the floor, surface, and any surrounding clutter or other items.
2. Even out the lighting so it looks like soft, balanced studio light — remove harsh shadows, hotspots, and any color cast from the original photo.
3. Gently REDUCE harsh or distracting wrinkles and creases, but do NOT remove them entirely — the jeans should still look like real, natural fabric with believable folds. Keep it authentic, not plastic or over-smoothed.
4. Keep the existing position, angle, and drape of the jeans from the original photo. They do not need to be perfectly symmetrical or flat.

DO NOT:
- Change the color, wash, fading, or distressing of the denim
- Change the cut, rise, inseam, leg width, or any proportions
- Add or remove details (pockets, stitching, rivets, buttons, tags, hems)
- Reconstruct, redraw, or re-pose the garment — preserve the original layout
- Over-smooth the fabric or make it look artificial
- Add a drop shadow or cast shadow — the bottoms should sit cleanly on white

FRAMING:
- Output a TALL VERTICAL PORTRAIT image with a 9:16 aspect ratio (much taller than wide), suited to the long shape of jeans.
- Keep the jeans centered with balanced white margins.

OUTPUT: The same jeans from my photo, on a clean white background with even lighting and softened (not erased) wrinkles, tall 9:16 vertical format, no shadow.`,
    },
  ],

  shoes: [
    {
      style: "profile",
      prompt: `You are processing a product photo for an online footwear boutique. The shoe must remain 100% faithful to the original — this is a real product a customer will receive.

SUBJECT: The shoe/footwear (boot, sandal, sneaker, heel, flat, etc.) is the only product being photographed. Remove any foot, leg, mannequin, box, stand, surface, or background clutter. If a matching pair is shown, keep both shoes; otherwise keep the single shoe.

TASK:
1. Isolate the footwear as described above.
2. Present it as a clean side / three-quarter angled product shot (the standard footwear catalog angle), viewed slightly from the front-outer side so both the profile and a hint of the toe are visible, toe pointing to the left, sitting level as if on an invisible flat surface.
3. If a pair is shown, place both shoes side by side at the same angle, slightly staggered as is standard for catalog footwear, both toes pointing left.
4. Preserve the true silhouette, heel height, sole thickness, laces, buckles, straps, and all hardware exactly.

${sharedRules("Output a SQUARE image (1:1 aspect ratio).")}
OUTPUT: A clean side/angled-profile catalog product photo on pure white, suitable for a Shopify listing.`,
    },
  ],
};

// ---- Helpers -------------------------------------------------------------

// Identify the image format from the leading bytes of the base64 data so we
// can tell Gemini the correct mime type. Covers the formats an iPhone or
// browser will realistically produce.
function detectMimeType(base64: string): string {
  // Decode just the first chunk of bytes — enough to read file signatures.
  const head = Buffer.from(base64.slice(0, 64), "base64");
  const bytes = Array.from(head.subarray(0, 16));
  const hex = bytes.map((b: number) => b.toString(16).padStart(2, "0")).join("");

  // JPEG: starts FF D8 FF
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (hex.startsWith("89504e47")) return "image/png";
  // WebP: "RIFF"...."WEBP"
  if (hex.startsWith("52494646") && hex.includes("57454250"))
    return "image/webp";
  // HEIC/HEIF: bytes 4-8 are "ftyp", followed by a brand like heic/heif/mif1
  const ascii = head.toString("ascii");
  if (ascii.includes("ftyp")) {
    if (
      ascii.includes("heic") ||
      ascii.includes("heif") ||
      ascii.includes("mif1") ||
      ascii.includes("heix") ||
      ascii.includes("hevc")
    ) {
      return "image/heic";
    }
  }
  // Fallback — assume JPEG.
  return "image/jpeg";
}

// Run a single style prompt through Gemini and return the resulting image.
// Returns { ok: true, image } on success or { ok: false, detail } on failure
// so the caller can decide how to handle a partial failure.
async function runGemini(
  sp: { style: string; prompt: string },
  base64: string,
  mimeType: string
): Promise<{ ok: boolean; image?: string; detail?: string }> {
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY || "",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: sp.prompt },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            // Force the model to return an image, not a text description.
            // Without this, long prompts sometimes get a written reply.
            responseModalities: ["IMAGE"],
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return { ok: false, detail: `[${sp.style}] ${errText}` };
    }

    const data = await geminiRes.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(
      (p: any) => p.inline_data?.data || p.inlineData?.data
    );
    const outImage =
      imagePart?.inline_data?.data || imagePart?.inlineData?.data;

    if (!outImage) {
      return {
        ok: false,
        detail: `[${sp.style}] No image returned from Gemini`,
      };
    }

    return { ok: true, image: outImage };
  } catch (err: any) {
    return { ok: false, detail: `[${sp.style}] ${String(err?.message || err)}` };
  }
}

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
    const stylePrompts = PROMPTS[type];
    if (!stylePrompts) {
      return res.status(400).json({
        error: `Unknown itemType "${type}". Use top, jeans, or shoes.`,
      });
    }

    // Strip a data URL prefix if the shortcut sends one, then remove ALL
    // whitespace (iOS Shortcuts inserts \r\n line breaks every 64 chars,
    // which makes Gemini's base64 decoder fail).
    const rawBase64 = image.includes(",") ? image.split(",")[1] : image;
    const base64 = rawBase64.replace(/\s+/g, "");

    // Detect the real image type from the first decoded bytes. iPhones shoot
    // HEIC by default, not JPEG, so we can't hardcode the mime type.
    const mimeType = detectMimeType(base64);

    // Run the style(s) for this item type. Every item type currently has
    // exactly one style, but this still works if more are added later.
    const results = await Promise.all(
      stylePrompts.map((sp) => runGemini(sp, base64, mimeType))
    );

    // If any style failed, surface the first error.
    const failed = results.find((r) => !r.ok);
    if (failed) {
      return res.status(502).json({
        error: "Gemini request failed",
        detail: failed.detail,
      });
    }

    // Return the single processed image under the "image" key, matching the
    // shape the iOS Shortcut already expects (no Shortcut changes needed).
    return res.status(200).json({ image: results[0].image });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: "Server error", detail: String(err?.message || err) });
  }
}
