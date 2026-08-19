// GENERATED FILE — do not hand-edit.
// Produced by packages/ui/scripts/build-tokens.mjs. Change the source CSS in
// /design and re-run `pnpm --filter @brewledger/ui build:tokens`.
//
// Consumed as a Tailwind v4 theme extension by both apps' root CSS entry
// point (see packages/ui/README.md). tapTarget and orderStatus are
// BrewLedger-specific extensions with no stock Tailwind theme key — kept out
// of `colors` deliberately so `bg-unpaid-bg` can't be written as an
// arbitrary utility divorced from OrderStatusBadge/StatusButton.

export interface BrewLedgerThemeExtend {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  fontSize: Record<string, string>;
  lineHeight: Record<string, string>;
  letterSpacing: Record<string, string>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  boxShadow: Record<string, string>;
  transitionTimingFunction: Record<string, string>;
  transitionDuration: Record<string, string>;
  tapTarget: { min: string; wet: string };
  orderStatus: Record<string, { bg: string; fg: string }>;
  pressScale: string;
}

export const brewLedgerThemeExtend: BrewLedgerThemeExtend = {
  "colors": {
    "greenLedger": "#0b6b47",
    "greenBrew": "#14875a",
    "greenCask": "#16302b",
    "greenSage": "#3c5e54",
    "greenMist": "#d7ecdf",
    "gold": "#c9a15b",
    "goldLight": "#ddc190",
    "goldLightest": "#faf6ec",
    "parchment": "#f3f0ea",
    "ceramic": "#eeebe6",
    "neutralCool": "#f8f8f7",
    "white": "#ffffff",
    "black": "#000000",
    "textBlack": "rgba(0,0,0,.87)",
    "textBlackSoft": "rgba(0,0,0,.58)",
    "textWhite": "rgba(255,255,255,1)",
    "textWhiteSoft": "rgba(255,255,255,.7)",
    "rewardsSlate": "#33433d",
    "red": "#c0281c",
    "redTint": "hsl(4 78% 43% / 6%)",
    "yellow": "#e0a728",
    "greenMistTint": "hsl(152 34% 87% / 33%)",
    "inputBorder": "#d6dbde",
    "hairline": "#e7e7e7",
    "surfacePage": "#f3f0ea",
    "surfaceCard": "#ffffff",
    "surfaceUtility": "#eeebe6",
    "brandHeading": "#0b6b47",
    "brandCta": "#14875a",
    "brandBand": "#16302b",
    "overlayBlack06": "rgba(0,0,0,.06)",
    "overlayBlack24": "rgba(0,0,0,.24)",
    "overlayBlack60": "rgba(0,0,0,.6)",
    "overlayWhite10": "rgba(255,255,255,.1)",
    "overlayWhite60": "rgba(255,255,255,.6)",
    "overlayWhite90": "rgba(255,255,255,.9)",
    "revenue": "#14875a",
    "cost": "oklch(.52 .085 62)",
    "profit": "#0b6b47",
    "warning": "#e0a728",
    "unknown": "rgba(0,0,0,.38)",
    "negative": "#c0281c"
  },
  "fontFamily": {
    "sans": [
      "'Noto Sans Thai'",
      "'Manrope'",
      "\"Helvetica Neue\"",
      "Helvetica",
      "Arial",
      "sans-serif"
    ],
    "serif": [
      "'Lora'",
      "\"Iowan Old Style\"",
      "Georgia",
      "serif"
    ],
    "script": [
      "'Kalam'",
      "\"Comic Sans MS\"",
      "cursive"
    ]
  },
  "fontSize": {
    "text-1": "13px",
    "text-2": "14px",
    "text-3": "16px",
    "text-4": "19px",
    "text-5": "24px",
    "text-6": "28px",
    "text-7": "32px",
    "text-8": "45px",
    "text-9": "58px",
    "text-10": "80px"
  },
  "lineHeight": {
    "normal": "1.5",
    "compact": "1.2",
    "thai-body": "1.5",
    "thai-head": "1.35"
  },
  "letterSpacing": {
    "normal": "-0.01em",
    "loose": ".1em",
    "looser": ".15em"
  },
  "spacing": {
    "space-1": "4px",
    "space-2": "8px",
    "space-3": "16px",
    "space-4": "24px",
    "space-5": "32px",
    "space-6": "40px",
    "space-7": "48px",
    "space-8": "56px",
    "space-9": "64px",
    "gutter-sm": "16px",
    "gutter-md": "24px",
    "gutter-lg": "40px",
    "col-sm": "343px",
    "col-md": "500px",
    "col-lg": "720px",
    "col-xl": "1440px"
  },
  "borderRadius": {
    "card": "12px",
    "pill": "50px",
    "circle": "50%",
    "input": "4px"
  },
  "boxShadow": {
    "card": "0 0 .5px rgba(0,0,0,.14),0 1px 1px rgba(0,0,0,.24)",
    "nav": "0 1px 3px rgba(0,0,0,.1),0 2px 2px rgba(0,0,0,.06),0 0 2px rgba(0,0,0,.07)",
    "fab-base": "0 0 6px rgba(0,0,0,.24)",
    "fab-ambient": "0 8px 12px rgba(0,0,0,.14)",
    "fab-ambient-active": "0 8px 12px rgba(0,0,0,0)"
  },
  "transitionTimingFunction": {
    "standard": "cubic-bezier(.25,.46,.45,.94)",
    "spring": "cubic-bezier(.32,2.32,.61,.27)"
  },
  "transitionDuration": {
    "fast": ".2s",
    "standard": ".3s",
    "slow": ".4s"
  },
  "tapTarget": {
    "min": "44px",
    "wet": "56px"
  },
  "orderStatus": {
    "unpaid": {
      "bg": "#fdf3dd",
      "fg": "#8a6410"
    },
    "accepted": {
      "bg": "#eeebe6",
      "fg": "#3c5e54"
    },
    "making": {
      "bg": "#d7ecdf",
      "fg": "#0b6b47"
    },
    "ready": {
      "bg": "#14875a",
      "fg": "#fff"
    },
    "collected": {
      "bg": "#f8f8f7",
      "fg": "rgba(0,0,0,.58)"
    },
    "cancelled": {
      "bg": "hsl(4 78% 43% / 6%)",
      "fg": "#c0281c"
    },
    "refunded": {
      "bg": "#f8f8f7",
      "fg": "#c0281c"
    },
    "expired": {
      "bg": "#f8f8f7",
      "fg": "rgba(0,0,0,.38)"
    }
  },
  "pressScale": ".95"
} as const;

export default brewLedgerThemeExtend;
