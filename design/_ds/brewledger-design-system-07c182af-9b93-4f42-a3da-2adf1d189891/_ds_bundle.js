/* @ds-bundle: {"format":4,"namespace":"BrewledgerDesignSystem_07c182","components":[{"name":"FloatingOrderButton","sourcePath":"components/actions/FloatingOrderButton.jsx"},{"name":"Accordion","sourcePath":"components/feedback/Accordion.jsx"},{"name":"RewardsPill","sourcePath":"components/feedback/RewardsPill.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"NavBar","sourcePath":"components/navigation/NavBar.jsx"},{"name":"Card","sourcePath":"components/surfaces/Card.jsx"},{"name":"FeatureBand","sourcePath":"components/surfaces/FeatureBand.jsx"},{"name":"StatusPanel","sourcePath":"components/surfaces/StatusPanel.jsx"}],"sourceHashes":{"components/actions/FloatingOrderButton.jsx":"6016542c232f","components/feedback/Accordion.jsx":"99c64898d4e7","components/feedback/RewardsPill.jsx":"ce9cd1b40d90","components/forms/Button.jsx":"7795ee127e99","components/forms/Input.jsx":"1bf39a4661aa","components/navigation/NavBar.jsx":"0d43c5b6c5f0","components/surfaces/Card.jsx":"01ca1d48ea32","components/surfaces/FeatureBand.jsx":"3784b768b1f0","components/surfaces/StatusPanel.jsx":"f005d91a5469","ui_kits/brewledger-web/Home.jsx":"4210c5936e41","ui_kits/brewledger-web/ProductDetail.jsx":"22e4f8d4fe5f","ui_kits/brewledger-web/Rewards.jsx":"3322c588c597"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.BrewledgerDesignSystem_07c182 = window.BrewledgerDesignSystem_07c182 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/FloatingOrderButton.jsx
try { (() => {
const {
  useState
} = React;
function FloatingOrderButton({
  size = 56
}) {
  const [pressed, setPressed] = useState(false);
  return React.createElement('button', {
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false),
    onMouseLeave: () => setPressed(false),
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'var(--green-brew)',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transform: pressed ? 'scale(var(--press-scale))' : 'scale(1)',
      boxShadow: pressed ? 'var(--shadow-fab-base),var(--shadow-fab-ambient-active)' : 'var(--shadow-fab-base),var(--shadow-fab-ambient)',
      transition: 'all var(--duration-fast) ease'
    }
  }, React.createElement('svg', {
    width: size * .42,
    height: size * .42,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#fff',
    strokeWidth: 2
  }, React.createElement('path', {
    d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z'
  }), React.createElement('path', {
    d: 'M3 6h18'
  }), React.createElement('path', {
    d: 'M16 10a4 4 0 0 1-8 0'
  })));
}
Object.assign(__ds_scope, { FloatingOrderButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/FloatingOrderButton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Accordion.jsx
try { (() => {
function Accordion({
  items
}) {
  const [open, setOpen] = React.useState(0);
  return React.createElement('div', {
    style: {
      fontFamily: 'var(--font-sans)'
    }
  }, items.map((it, i) => React.createElement('div', {
    key: i,
    style: {
      borderBottom: '1px solid var(--hairline)'
    }
  }, React.createElement('button', {
    onClick: () => setOpen(open === i ? -1 : i),
    style: {
      width: '100%',
      textAlign: 'left',
      background: 'none',
      border: 'none',
      padding: '16px 0',
      fontSize: 16,
      fontWeight: 600,
      color: 'var(--text-black)',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between'
    }
  }, it.q, React.createElement('span', null, open === i ? '−' : '+')), React.createElement('div', {
    style: {
      maxHeight: open === i ? 200 : 0,
      overflow: 'hidden',
      transition: 'max-height var(--duration-standard) var(--ease-standard)'
    }
  }, React.createElement('p', {
    style: {
      color: 'var(--text-black-soft)',
      fontSize: 14,
      paddingBottom: 16,
      margin: 0
    }
  }, it.a)))));
}
Object.assign(__ds_scope, { Accordion });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Accordion.jsx", error: String((e && e.message) || e) }); }

// components/feedback/RewardsPill.jsx
try { (() => {
function RewardsPill({
  stars,
  label
}) {
  if (stars !== undefined) {
    return React.createElement('span', {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        border: '1px solid var(--gold)',
        color: 'var(--gold)',
        borderRadius: 'var(--radius-pill)',
        padding: '4px 12px',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '.05em'
      }
    }, `★ ${stars} pts`);
  }
  return React.createElement('span', {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      background: 'var(--green-mist)',
      color: 'var(--green-cask)',
      borderRadius: 'var(--radius-pill)',
      padding: '4px 12px',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 600
    }
  }, label);
}
Object.assign(__ds_scope, { RewardsPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/RewardsPill.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
const VARIANTS = {
  primary: {
    background: 'var(--green-brew)',
    color: '#fff',
    border: '1px solid var(--green-brew)'
  },
  outline: {
    background: 'transparent',
    color: 'var(--green-brew)',
    border: '1px solid var(--green-brew)'
  },
  dark: {
    background: 'var(--black)',
    color: '#fff',
    border: '1px solid var(--black)'
  },
  'dark-outline': {
    background: 'transparent',
    color: 'var(--text-black)',
    border: '1px solid var(--text-black)'
  },
  inverted: {
    background: '#fff',
    color: 'var(--green-brew)',
    border: '1px solid #fff'
  },
  'outline-on-dark': {
    background: 'transparent',
    color: '#fff',
    border: '1px solid #fff'
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  children,
  onClick,
  style,
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const pad = size === 'lg' ? '14px 32px' : '7px 16px';
  const fontSize = size === 'lg' ? 16 : 14;
  return React.createElement('button', {
    onClick,
    disabled,
    style: {
      fontFamily: 'var(--font-sans)',
      letterSpacing: 'var(--tracking-normal)',
      fontWeight: 600,
      fontSize,
      padding: pad,
      borderRadius: 'var(--radius-pill)',
      cursor: disabled ? 'default' : 'pointer',
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
      opacity: disabled ? .5 : 1,
      transition: 'all var(--duration-fast) ease',
      ...v,
      ...style
    },
    onMouseDown: e => {
      if (!disabled) e.currentTarget.style.transform = 'scale(var(--press-scale))';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'scale(1)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = 'scale(1)';
    },
    ...rest
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
const {
  useState
} = React;
function Input({
  label,
  value,
  defaultValue,
  onChange,
  state = 'default',
  type = 'text'
}) {
  const [val, setVal] = useState(defaultValue || '');
  const current = value !== undefined ? value : val;
  const active = !!current;
  const tint = state === 'valid' ? {
    background: 'var(--green-mist-tint)',
    border: '1px solid var(--green-brew)'
  } : state === 'invalid' ? {
    background: 'var(--red-tint)',
    border: '1px solid var(--red)'
  } : {
    background: '#fff',
    border: '1px solid var(--input-border)'
  };
  return React.createElement('div', {
    style: {
      position: 'relative',
      fontFamily: 'var(--font-sans)'
    }
  }, React.createElement('input', {
    type,
    value: current,
    onChange: e => {
      setVal(e.target.value);
      onChange && onChange(e.target.value);
    },
    style: {
      width: '100%',
      boxSizing: 'border-box',
      padding: '16px 12px 8px',
      borderRadius: 'var(--radius-input)',
      fontSize: 16,
      color: 'var(--text-black)',
      outline: 'none',
      ...tint
    }
  }), React.createElement('label', {
    style: {
      position: 'absolute',
      left: 12,
      top: active ? 4 : '50%',
      fontSize: active ? '1.3rem' : '1.9rem',
      color: 'var(--text-black-soft)',
      transform: active ? 'none' : 'translateY(-50%)',
      transition: 'all .2s ease',
      pointerEvents: 'none'
    }
  }, label));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavBar.jsx
try { (() => {
function NavBar({
  links = ['Menu', 'Rewards', 'Gift Cards']
}) {
  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 83,
      padding: '0 40px',
      background: '#fff',
      boxShadow: 'var(--shadow-nav)',
      fontFamily: 'var(--font-sans)'
    }
  }, React.createElement('div', {
    style: {
      fontWeight: 700,
      fontSize: 20,
      color: 'var(--green-ledger)'
    }
  }, 'Brewledger'), React.createElement('div', {
    style: {
      display: 'flex',
      gap: 32
    }
  }, links.map(l => React.createElement('span', {
    key: l,
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--text-black)',
      cursor: 'pointer'
    }
  }, l))), React.createElement('div', {
    style: {
      display: 'flex',
      gap: 12
    }
  }, React.createElement('button', {
    style: {
      background: 'transparent',
      border: '1px solid var(--text-black)',
      borderRadius: 'var(--radius-pill)',
      padding: '7px 16px',
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-black)'
    }
  }, 'Sign in'), React.createElement('button', {
    style: {
      background: 'var(--black)',
      border: '1px solid var(--black)',
      color: '#fff',
      borderRadius: 'var(--radius-pill)',
      padding: '7px 16px',
      fontSize: 14,
      fontWeight: 600
    }
  }, 'Join now')));
}
Object.assign(__ds_scope, { NavBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavBar.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Card.jsx
try { (() => {
function Card({
  children,
  padding = '24px',
  style
}) {
  return React.createElement('div', {
    style: {
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-card)',
      boxShadow: 'var(--shadow-card)',
      padding,
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Card.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/FeatureBand.jsx
try { (() => {
function FeatureBand({
  heading,
  body,
  children,
  align = 'left'
}) {
  return React.createElement('div', {
    style: {
      background: 'var(--green-cask)',
      padding: '56px 40px',
      display: 'flex',
      gap: 40,
      alignItems: 'center',
      fontFamily: 'var(--font-sans)',
      flexDirection: align === 'right' ? 'row-reverse' : 'row'
    }
  }, React.createElement('div', {
    style: {
      flex: 1
    }
  }, React.createElement('h2', {
    style: {
      color: '#fff',
      fontSize: 28,
      fontWeight: 600,
      margin: '0 0 12px'
    }
  }, heading), React.createElement('p', {
    style: {
      color: 'var(--text-white-soft)',
      fontSize: 16,
      lineHeight: 1.6,
      margin: '0 0 20px'
    }
  }, body), children), React.createElement('div', {
    style: {
      flex: 1,
      height: 220,
      background: 'var(--green-sage)',
      borderRadius: 12
    }
  }));
}
Object.assign(__ds_scope, { FeatureBand });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/FeatureBand.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/StatusPanel.jsx
try { (() => {
const RIBBON = {
  bronze: '#a9724d',
  silver: '#9aa5a8',
  gold: 'var(--gold)'
};
function StatusPanel({
  tier = 'gold',
  benefits = []
}) {
  return React.createElement('div', {
    style: {
      background: 'var(--green-cask)',
      borderRadius: 'var(--radius-card)',
      overflow: 'hidden',
      fontFamily: 'var(--font-sans)',
      width: 260
    }
  }, React.createElement('div', {
    style: {
      height: 6,
      background: RIBBON[tier]
    }
  }), React.createElement('div', {
    style: {
      padding: 24
    }
  }, React.createElement('div', {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: RIBBON[tier],
      letterSpacing: '.1em',
      textTransform: 'uppercase'
    }
  }, tier), React.createElement('div', {
    style: {
      fontSize: 22,
      fontWeight: 600,
      color: '#fff',
      margin: '6px 0 16px'
    }
  }, tier.charAt(0).toUpperCase() + tier.slice(1) + ' status'), React.createElement('ul', {
    style: {
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, benefits.map((b, i) => React.createElement('li', {
    key: i,
    style: {
      color: 'var(--text-white-soft)',
      fontSize: 14
    }
  }, '• ' + b))), React.createElement('div', {
    style: {
      marginTop: 16,
      fontSize: 13,
      color: 'var(--text-white-soft)'
    }
  }, 'As you earn more stars…')));
}
Object.assign(__ds_scope, { StatusPanel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/StatusPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/brewledger-web/Home.jsx
try { (() => {
const {
  NavBar,
  Button,
  FeatureBand,
  Card,
  RewardsPill,
  FloatingOrderButton
} = window.BrewledgerDesignSystem_07c182;
const MENU = [{
  name: 'Autumn Cascara Latte',
  desc: 'Espresso, cascara syrup, oat milk',
  stars: 200
}, {
  name: 'Cold Brew, Original',
  desc: 'Slow-steeped 20 hours',
  stars: 150
}, {
  name: 'Maple Pecan Cortado',
  desc: 'Double espresso, steamed milk',
  stars: 200
}];
function Home() {
  return React.createElement('div', {
    style: {
      background: 'var(--parchment)',
      minHeight: '100vh'
    }
  }, React.createElement(NavBar, null), React.createElement('div', {
    style: {
      padding: '64px 40px',
      display: 'flex',
      alignItems: 'center',
      gap: 48
    }
  }, React.createElement('div', {
    style: {
      flex: 1
    }
  }, React.createElement('h1', {
    style: {
      fontSize: 45,
      fontWeight: 600,
      color: 'var(--green-ledger)',
      lineHeight: 1.15,
      margin: '0 0 16px'
    }
  }, 'The fall menu is here.'), React.createElement('p', {
    style: {
      fontSize: 19,
      color: 'var(--text-black-soft)',
      lineHeight: 1.6,
      margin: '0 0 24px',
      maxWidth: 440
    }
  }, 'Cascara, maple, and pecan — three new drinks through November.'), React.createElement('div', {
    style: {
      display: 'flex',
      gap: 12
    }
  }, React.createElement(Button, {
    variant: 'primary'
  }, 'Explore the fall menu'), React.createElement(Button, {
    variant: 'outline'
  }, 'Start an order'))), React.createElement('div', {
    style: {
      flex: 1,
      height: 320,
      background: 'var(--green-mist)',
      borderRadius: 16
    }
  })), React.createElement('div', {
    style: {
      padding: '0 40px 64px'
    }
  }, React.createElement('h2', {
    style: {
      fontSize: 24,
      fontWeight: 400,
      color: 'var(--text-black)',
      margin: '0 0 24px'
    }
  }, 'Popular right now'), React.createElement('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16
    }
  }, MENU.map(m => React.createElement(Card, {
    key: m.name
  }, React.createElement('div', {
    style: {
      height: 120,
      background: 'var(--ceramic)',
      borderRadius: 8,
      marginBottom: 16
    }
  }), React.createElement('div', {
    style: {
      fontWeight: 600,
      fontSize: 16,
      marginBottom: 6
    }
  }, m.name), React.createElement('div', {
    style: {
      color: 'var(--text-black-soft)',
      fontSize: 14,
      marginBottom: 12
    }
  }, m.desc), React.createElement(RewardsPill, {
    stars: m.stars
  }))))), React.createElement(FeatureBand, {
    heading: 'Free coffee is just the beginning.',
    body: 'Join Brewledger Rewards and earn stars on every order — redeem for drinks, food, and merchandise.'
  }, React.createElement('div', {
    style: {
      display: 'flex',
      gap: 12
    }
  }, React.createElement(Button, {
    variant: 'inverted'
  }, 'Join Rewards'), React.createElement(Button, {
    variant: 'outline-on-dark'
  }, 'Learn more'))), React.createElement('div', {
    style: {
      position: 'fixed',
      bottom: 24,
      right: 24
    }
  }, React.createElement(FloatingOrderButton, null)));
}
window.Home = Home;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/brewledger-web/Home.jsx", error: String((e && e.message) || e) }); }

// ui_kits/brewledger-web/ProductDetail.jsx
try { (() => {
const {
  NavBar,
  Button,
  RewardsPill
} = window.BrewledgerDesignSystem_07c182;
const {
  useState
} = React;
const SIZES = ['Tall', 'Grande', 'Venti'];
const OZ = {
  Tall: '12 fl oz',
  Grande: '16 fl oz',
  Venti: '20 fl oz'
};
function ProductDetail() {
  const [size, setSize] = useState('Grande');
  return React.createElement('div', {
    style: {
      background: 'var(--parchment)',
      minHeight: '100vh'
    }
  }, React.createElement(NavBar, null), React.createElement('div', {
    style: {
      padding: '24px 40px 0',
      fontSize: 14,
      color: 'var(--text-black-soft)'
    }
  }, 'Menu / Lattes / ', React.createElement('span', {
    style: {
      color: 'var(--text-black)'
    }
  }, 'Autumn Cascara Latte')), React.createElement('div', {
    style: {
      background: 'var(--green-cask)',
      margin: '24px 40px',
      borderRadius: 16,
      padding: '40px',
      display: 'flex',
      gap: 40,
      alignItems: 'center'
    }
  }, React.createElement('div', {
    style: {
      width: 220,
      height: 220,
      background: 'var(--green-sage)',
      borderRadius: 12
    }
  }), React.createElement('div', {
    style: {
      flex: 1
    }
  }, React.createElement('h1', {
    style: {
      color: '#fff',
      fontSize: 32,
      fontWeight: 700,
      margin: '0 0 12px'
    }
  }, 'Autumn Cascara Latte'), React.createElement(RewardsPill, {
    stars: 200
  }), React.createElement('p', {
    style: {
      color: '#fff',
      fontSize: 16,
      lineHeight: 1.6,
      margin: '16px 0'
    }
  }, 'Espresso meets cascara syrup, steamed milk, and a dusting of cinnamon.'), React.createElement('div', {
    style: {
      color: 'var(--text-white-soft)',
      fontSize: 14,
      fontWeight: 700
    }
  }, '190 calories, 24g sugar, 6g fat'))), React.createElement('div', {
    style: {
      padding: '0 40px 40px'
    }
  }, React.createElement('div', {
    style: {
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      color: 'var(--text-black-soft)',
      marginBottom: 12
    }
  }, 'Size'), React.createElement('div', {
    style: {
      display: 'flex',
      gap: 16,
      marginBottom: 32
    }
  }, SIZES.map(s => React.createElement('button', {
    key: s,
    onClick: () => setSize(s),
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'center'
    }
  }, React.createElement('div', {
    style: {
      width: 48,
      height: 48,
      borderRadius: '50%',
      border: size === s ? '2px solid var(--green-brew)' : '1px solid transparent',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 6px'
    }
  }, React.createElement('div', {
    style: {
      width: 24,
      height: 30,
      background: 'var(--green-sage)',
      borderRadius: '2px 2px 6px 6px'
    }
  })), React.createElement('div', {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: 'var(--green-ledger)'
    }
  }, s), React.createElement('div', {
    style: {
      fontSize: 12,
      color: 'var(--text-black-soft)'
    }
  }, OZ[s])))), React.createElement('div', {
    style: {
      display: 'flex',
      gap: 12
    }
  }, React.createElement(Button, {
    variant: 'outline',
    size: 'lg'
  }, '✨ Customize'), React.createElement(Button, {
    variant: 'primary',
    size: 'lg'
  }, 'Add to order'))));
}
window.ProductDetail = ProductDetail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/brewledger-web/ProductDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/brewledger-web/Rewards.jsx
try { (() => {
const {
  NavBar,
  StatusPanel,
  Accordion,
  Button
} = window.BrewledgerDesignSystem_07c182;
function Rewards() {
  return React.createElement('div', {
    style: {
      background: 'var(--parchment)',
      minHeight: '100vh'
    }
  }, React.createElement(NavBar, null), React.createElement('div', {
    style: {
      background: 'var(--green-cask)',
      padding: '56px 40px',
      textAlign: 'center'
    }
  }, React.createElement('h1', {
    style: {
      fontFamily: 'var(--font-serif)',
      fontWeight: 600,
      fontSize: 44,
      color: '#fff',
      margin: '0 0 12px'
    }
  }, 'Free coffee is just the beginning.'), React.createElement('p', {
    style: {
      color: 'var(--text-white-soft)',
      fontSize: 18,
      margin: '0 0 24px'
    }
  }, 'Earn 1 star per $1. Redeem for drinks, food, and more.'), React.createElement(Button, {
    variant: 'inverted'
  }, 'Join Brewledger Rewards')), React.createElement('div', {
    style: {
      padding: '48px 40px'
    }
  }, React.createElement('h2', {
    style: {
      fontSize: 24,
      fontWeight: 400,
      margin: '0 0 24px',
      color: 'var(--text-black)'
    }
  }, 'Membership tiers'), React.createElement('div', {
    style: {
      display: 'flex',
      gap: 16,
      flexWrap: 'wrap'
    }
  }, React.createElement(StatusPanel, {
    tier: 'bronze',
    benefits: ['Free refills in-cafe', 'Birthday reward']
  }), React.createElement(StatusPanel, {
    tier: 'silver',
    benefits: ['Free refills', '2x star days', 'Order customization']
  }), React.createElement(StatusPanel, {
    tier: 'gold',
    benefits: ['Free birthday drink', 'Extra star days', 'Priority pickup']
  }))), React.createElement('div', {
    style: {
      background: 'var(--gold-lightest)',
      padding: '48px 40px',
      textAlign: 'center'
    }
  }, React.createElement('h3', {
    style: {
      fontSize: 20,
      fontWeight: 600,
      color: 'var(--rewards-slate)',
      margin: '0 0 8px'
    }
  }, 'Partner perks'), React.createElement('p', {
    style: {
      color: 'var(--text-black-soft)',
      fontSize: 14,
      margin: 0
    }
  }, 'Link a partner travel account to earn bonus stars on eligible purchases.')), React.createElement('div', {
    style: {
      padding: '48px 40px',
      maxWidth: 640
    }
  }, React.createElement('h3', {
    style: {
      fontSize: 20,
      fontWeight: 600,
      margin: '0 0 16px',
      color: 'var(--text-black)'
    }
  }, 'Frequently asked'), React.createElement(Accordion, {
    items: [{
      q: 'How do stars work?',
      a: 'Earn 1 star per $1 spent. Redeem stars for free drinks and food.'
    }, {
      q: 'Do stars expire?',
      a: 'Stars expire 12 months after the month they were earned.'
    }, {
      q: 'Can I transfer stars?',
      a: 'Stars are non-transferable between accounts.'
    }]
  })));
}
window.Rewards = Rewards;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/brewledger-web/Rewards.jsx", error: String((e && e.message) || e) }); }

__ds_ns.FloatingOrderButton = __ds_scope.FloatingOrderButton;

__ds_ns.Accordion = __ds_scope.Accordion;

__ds_ns.RewardsPill = __ds_scope.RewardsPill;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.NavBar = __ds_scope.NavBar;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.FeatureBand = __ds_scope.FeatureBand;

__ds_ns.StatusPanel = __ds_scope.StatusPanel;

})();
