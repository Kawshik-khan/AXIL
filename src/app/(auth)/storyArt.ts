/**
 * The isometric structure drawn on the sign-in story panel (StoryPanel.tsx), taken from the approved design canvas.
 * Coordinates are in the drawing's own 516 x 981 space. Colours are --auth-art-* tokens from tokens.css. Each face's
 * gradient runs along the face, so light and dark ends meet where faces join; the pillars fade out at their open ends.
 */

export type IsoStop = readonly [offset: number, token: string, opacity: number];
export type IsoGradient = { x1: number; y1: number; x2: number; y2: number; stops: readonly IsoStop[] };
export type IsoFace = { points: string; grad: string; masked: boolean };

export const ISO_GRADIENTS: Record<string, IsoGradient> = {"g10": {"x1": 53.2, "y1": 449.1, "x2": 52.6, "y2": 547.4, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g11": {"x1": 224.0, "y1": 727.7, "x2": 258.8, "y2": 490.5, "stops": [[0.0, "--auth-art-gray-200", 1], [0.5, "--auth-art-gray-600", 1], [1.0, "--auth-art-ink-800", 1]]}, "g12": {"x1": 361.6, "y1": 431.9, "x2": 120.7, "y2": 331.2, "stops": [[0.0, "--auth-art-lime-soft", 1], [0.5, "--auth-art-lime", 1], [1.0, "--auth-art-gray-600", 1]]}, "g13": {"x1": 325.9, "y1": 490.1, "x2": 120.7, "y2": 331.1, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g14": {"x1": 258.8, "y1": 591.2, "x2": 325.9, "y2": 669.1, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g15": {"x1": 291.8, "y1": 610.1, "x2": 258.8, "y2": 549.1, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g16": {"x1": 325.9, "y1": 630.0, "x2": 292.6, "y2": 470.8, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g17": {"x1": 155.8, "y1": 429.9, "x2": 122.0, "y2": 371.6, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g18": {"x1": 156.0, "y1": 390.5, "x2": 190.8, "y2": 450.7, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g19": {"x1": 326.9, "y1": 669.1, "x2": 361.6, "y2": 431.9, "stops": [[0.0, "--auth-art-gray-200", 1], [0.5, "--auth-art-gray-600", 1], [1.0, "--auth-art-ink-800", 1]]}, "g2": {"x1": 516.1, "y1": 321.3, "x2": 36.3, "y2": 598.3, "stops": [[0.0, "--auth-art-gray-200", 1], [0.5, "--auth-art-gray-600", 1], [1.0, "--auth-art-ink-800", 1]]}, "g20": {"x1": 464.5, "y1": 371.6, "x2": 223.5, "y2": 271.0, "stops": [[0.0, "--auth-art-lime-soft", 1], [0.5, "--auth-art-lime", 1], [1.0, "--auth-art-gray-600", 1]]}, "g21": {"x1": 428.7, "y1": 429.9, "x2": 223.6, "y2": 270.9, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g22": {"x1": 361.6, "y1": 530.9, "x2": 428.7, "y2": 608.9, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g23": {"x1": 394.6, "y1": 549.9, "x2": 361.6, "y2": 488.9, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g24": {"x1": 428.7, "y1": 569.8, "x2": 395.5, "y2": 410.6, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g25": {"x1": 258.5, "y1": 371.6, "x2": 224.9, "y2": 311.4, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g26": {"x1": 258.9, "y1": 330.3, "x2": 292.4, "y2": 391.4, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g27": {"x1": 429.7, "y1": 608.9, "x2": 464.5, "y2": 371.6, "stops": [[0.0, "--auth-art-gray-200", 1], [0.5, "--auth-art-gray-600", 1], [1.0, "--auth-art-ink-800", 1]]}, "g28": {"x1": 188.9, "y1": 587.5, "x2": 189.8, "y2": 550.5, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g29": {"x1": 292.3, "y1": 527.3, "x2": 261.2, "y2": 509.4, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g3": {"x1": 0.0, "y1": 577.6, "x2": 479.8, "y2": 341.6, "stops": [[0.0, "--auth-art-lime-soft", 1], [0.5, "--auth-art-lime", 1], [1.0, "--auth-art-gray-600", 1]]}, "g30": {"x1": 224.4, "y1": 431.3, "x2": 241.6, "y2": 440.0, "stops": [[0.0, "--auth-art-lime-soft", 1], [0.5, "--auth-art-lime", 1], [1.0, "--auth-art-gray-600", 1]]}, "g4": {"x1": 258.8, "y1": 490.5, "x2": 17.8, "y2": 389.9, "stops": [[0.0, "--auth-art-lime-soft", 1], [0.5, "--auth-art-lime", 1], [1.0, "--auth-art-gray-600", 1]]}, "g5": {"x1": 223.0, "y1": 548.8, "x2": 17.9, "y2": 389.8, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g6": {"x1": 71.3, "y1": 618.3, "x2": 223.0, "y2": 727.7, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g7": {"x1": 86.5, "y1": 609.6, "x2": 188.9, "y2": 668.8, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g8": {"x1": 223.0, "y1": 688.7, "x2": 189.8, "y2": 529.5, "stops": [[0.0, "--auth-art-lime", 1], [0.5, "--auth-art-lime-deep", 1], [1.0, "--auth-art-ink-900", 1]]}, "g9": {"x1": 17.9, "y1": 568.8, "x2": 19.2, "y2": 430.3, "stops": [[0.0, "--auth-art-gray-200", 1], [0.5, "--auth-art-gray-600", 1], [1.0, "--auth-art-ink-800", 1]]}, "pilgray": {"x1": 17.83, "y1": 592.21, "x2": 17.83, "y2": 987.5, "stops": [[0.0, "--auth-art-gray-200", 1.0], [0.4, "--auth-art-gray-600", 0.85], [0.75, "--auth-art-ink-800", 0.35], [1.0, "--auth-art-ink-800", 0.0]]}, "pillime": {"x1": 53.46, "y1": 603.5, "x2": 53.46, "y2": 973.38, "stops": [[0.0, "--auth-art-lime", 1.0], [0.4, "--auth-art-lime-deep", 0.85], [0.75, "--auth-art-ink-800", 0.35], [1.0, "--auth-art-ink-800", 0.0]]}, "topfade-dark": {"x1": 0.0, "y1": 341.62, "x2": 0.0, "y2": 0.0, "stops": [[0.0, "--auth-art-gray-600", 1.0], [0.4, "--auth-art-ink-700", 0.85], [0.75, "--auth-art-ink-800", 0.35], [1.0, "--auth-art-ink-800", 0.0]]}, "topfade-light": {"x1": 0.0, "y1": 341.62, "x2": 0.0, "y2": 0.0, "stops": [[0.0, "--auth-art-lime", 1.0], [0.4, "--auth-art-gray-400", 0.85], [0.75, "--auth-art-ink-800", 0.35], [1.0, "--auth-art-ink-800", 0.0]]}};

/** Painted in order. `masked` faces are the long beam, cut where it passes behind the frames. */
export const ISO_FACES: readonly IsoFace[] = [
  {"points": "479.76 341.62 516.12 321.26 516.12 0 479.76 0 479.76 341.62", "grad": "topfade-dark", "masked": false},
  {"points": "445.88 321.15 479.76 341.62 482.24 0 445.88 0 445.88 321.15", "grad": "topfade-light", "masked": false},
  {"points": "516.12 363.19 516.12 321.26 36.31 598.28 71.29 618.32 516.12 363.19", "grad": "g2", "masked": true},
  {"points": "479.76 341.62 445.88 321.15 0 577.62 35.63 597.22 479.76 341.62", "grad": "g3", "masked": true},
  {"points": "36.31 981 71.29 981 71.29 618.32 35.63 597.22 36.31 981", "grad": "pillime", "masked": false},
  {"points": ".34 981 35.32 981 35.66 598.09 0 576.98 .34 981", "grad": "pilgray", "masked": false},
  {"points": "224 509.38 17.83 389.85 53.65 370.56 258.76 490.5 224 509.38", "grad": "g4", "masked": false},
  {"points": "223 548.75 17.83 429.8 17.88 389.77 223 509.71 223 548.75", "grad": "g5", "masked": false},
  {"points": "223 727.74 69.78 643.03 71.29 618.32 86.53 609.59 223 688.7 223 727.74", "grad": "g6", "masked": false},
  {"points": "188.93 668.78 86.53 609.59 123.65 589.6 189.19 626.56 188.93 668.78", "grad": "g7", "masked": false},
  {"points": "223 688.7 188.93 668.78 189.77 529.48 223 548.75 223 688.7", "grad": "g8", "masked": false},
  {"points": "52.62 547.35 17.88 568.76 19.17 430.26 53.17 449.15 52.62 547.35", "grad": "g9", "masked": false},
  {"points": "86.61 527.8 52.62 547.35 53.17 449.15 86.95 469.79 86.61 527.8", "grad": "g10", "masked": false},
  {"points": "258.76 707.03 224 727.74 223.54 509.38 258.76 490.5 258.76 707.03", "grad": "g11", "masked": false},
  {"points": "326.85 450.74 120.68 331.21 156.5 311.91 361.62 431.85 326.85 450.74", "grad": "g12", "masked": false},
  {"points": "325.85 490.1 120.68 371.15 120.74 331.12 325.85 451.06 325.85 490.1", "grad": "g13", "masked": false},
  {"points": "325.85 669.09 259.76 627.97 258.35 602.09 258.76 591.16 325.85 630.05 325.85 669.09", "grad": "g14", "masked": false},
  {"points": "291.78 610.13 258.76 591.16 258.76 549.15 292.04 567.91 291.78 610.13", "grad": "g15", "masked": false},
  {"points": "325.85 630.05 291.78 610.13 292.63 470.84 325.85 490.1 325.85 630.05", "grad": "g16", "masked": false},
  {"points": "155.8 429.87 121.67 410.33 122.03 371.62 156.02 390.5 155.8 429.87", "grad": "g17", "masked": false},
  {"points": "190.76 450.74 155.8 429.87 156.02 390.5 189.8 411.14 190.76 450.74", "grad": "g18", "masked": false},
  {"points": "361.62 648.38 326.85 669.09 326.39 450.74 361.62 431.85 361.62 648.38", "grad": "g19", "masked": false},
  {"points": "429.71 390.5 223.54 270.97 259.35 251.68 464.47 371.62 429.71 390.5", "grad": "g20", "masked": false},
  {"points": "428.71 429.87 223.54 310.92 223.59 270.89 428.71 390.83 428.71 429.87", "grad": "g21", "masked": false},
  {"points": "428.71 608.85 362.62 567.74 361.21 541.85 361.62 530.93 428.71 569.82 428.71 608.85", "grad": "g22", "masked": false},
  {"points": "394.64 549.89 361.62 530.93 361.62 488.91 394.89 507.68 394.64 549.89", "grad": "g23", "masked": false},
  {"points": "428.71 569.82 394.64 549.89 395.48 410.6 428.71 429.87 428.71 569.82", "grad": "g24", "masked": false},
  {"points": "258.52 371.62 224.36 350.38 224.88 311.38 258.87 330.26 258.52 371.62", "grad": "g25", "masked": false},
  {"points": "292.42 391.39 258.52 371.62 258.87 330.26 292.66 350.91 292.42 391.39", "grad": "g26", "masked": false},
  {"points": "464.47 588.15 429.71 608.85 429.24 390.5 464.47 371.62 464.47 588.15", "grad": "g27", "masked": false},
  {"points": "157.71 568.76 189.8 550.47 188.93 587.5 157.71 568.76", "grad": "g28", "masked": false},
  {"points": "291.78 491.86 261.23 509.38 292.29 527.27 291.78 491.86", "grad": "g29", "masked": false},
  {"points": "224.36 448.57 224.36 431.26 241.61 439.97 224.36 448.57", "grad": "g30", "masked": false}
];

/** The frame faces the long beam passes behind; the mask cuts them out of the beam. */
export const ISO_BEAM_CUTS: readonly string[] = [
  "224 509.38 17.83 389.85 53.65 370.56 258.76 490.5 224 509.38",
  "223 548.75 17.83 429.8 17.88 389.77 223 509.71 223 548.75",
  "223 688.7 188.93 668.78 189.77 529.48 223 548.75 223 688.7",
  "258.76 707.03 224 727.74 223.54 509.38 258.76 490.5 258.76 707.03",
  "326.85 450.74 120.68 331.21 156.5 311.91 361.62 431.85 326.85 450.74",
  "325.85 490.1 120.68 371.15 120.74 331.12 325.85 451.06 325.85 490.1",
  "325.85 630.05 291.78 610.13 292.63 470.84 325.85 490.1 325.85 630.05",
  "361.62 648.38 326.85 669.09 326.39 450.74 361.62 431.85 361.62 648.38",
  "429.71 390.74 223.54 271.21 259.35 251.91 464.47 371.86 429.71 390.74",
  "428.71 430.1 223.54 311.15 223.59 271.12 428.71 391.07 428.71 430.1",
  "428.71 570.05 394.64 550.13 395.48 410.84 428.71 430.1 428.71 570.05",
  "464.47 588.39 429.71 609.09 429.24 390.74 464.47 371.86 464.47 588.39"
];
