(() => {
  const choices = {
    skin: ["light", "medium", "tan", "dark"],
    hair: ["short", "long", "curly", "bun"],
    hairColor: ["brown", "black", "blonde", "blue", "pink"],
    accessory: ["none", "glasses", "crown", "headphones", "cap"],
  };
  const defaults = { skin: "medium", hair: "short", hairColor: "brown", accessory: "none" };
  const skinColors = { light: "#f6d2b7", medium: "#d99b70", tan: "#a96843", dark: "#693e32" };
  const hairColors = { brown: "#57364b", black: "#202335", blonde: "#e3b550", blue: "#46bcd0", pink: "#ed70c5" };

  function normalize(avatar) {
    if (!avatar || typeof avatar !== "object") return { ...defaults };
    return Object.fromEntries(Object.entries(choices).map(([field, allowed]) => [
      field,
      allowed.includes(avatar[field]) ? avatar[field] : defaults[field],
    ]));
  }

  function render(avatar, className = "game-avatar") {
    const selected = normalize(avatar);
    const skin = skinColors[selected.skin];
    const hair = hairColors[selected.hairColor];
    const backHair = selected.hair === "long"
      ? `<path d="M17 37Q14 15 40 14Q67 15 64 40L61 68H19Z" fill="${hair}"/>`
      : selected.hair === "bun"
        ? `<circle cx="58" cy="21" r="10" fill="${hair}"/>`
        : "";
    const hairShape = {
      short: `<path d="M18 40Q15 14 40 14Q65 14 62 41L57 34Q48 37 40 29Q31 38 22 35Z" fill="${hair}"/>`,
      long: `<path d="M17 38Q15 14 40 14Q66 14 63 39L57 31Q48 34 40 27Q31 35 23 32Z" fill="${hair}"/>`,
      curly: `<path d="M18 37Q12 27 21 22Q20 11 31 16Q38 7 46 15Q58 9 61 22Q71 28 62 39L57 33Q48 35 40 28Q31 36 23 33Z" fill="${hair}"/><circle cx="21" cy="25" r="6" fill="${hair}"/><circle cx="31" cy="17" r="6" fill="${hair}"/><circle cx="43" cy="15" r="6" fill="${hair}"/><circle cx="55" cy="19" r="6" fill="${hair}"/><circle cx="62" cy="28" r="6" fill="${hair}"/>`,
      bun: `<path d="M19 39Q15 15 40 14Q64 15 61 40L56 33Q47 36 40 28Q31 36 23 33Z" fill="${hair}"/>`,
    }[selected.hair];
    const accessory = {
      none: "",
      glasses: `<path d="M23 39h12a5 5 0 0 1 0 10h-7a5 5 0 0 1-5-5v-5Zm22 0h12v5a5 5 0 0 1-5 5h-7a5 5 0 0 1 0-10ZM35 42h10" fill="none" stroke="#27334f" stroke-width="2.5" stroke-linejoin="round"/>`,
      crown: `<path d="m25 24 4 9 11-11 11 11 4-9 4 14H21Z" fill="#ffd46a" stroke="#fff1b7" stroke-width="1.5"/><circle cx="29" cy="24" r="2" fill="#ff63da"/><circle cx="40" cy="21" r="2" fill="#66f4ff"/><circle cx="51" cy="24" r="2" fill="#67f3bf"/>`,
      headphones: `<path d="M18 43V36a22 22 0 0 1 44 0v7" fill="none" stroke="#66f4ff" stroke-width="5"/><rect x="15" y="39" width="9" height="15" rx="4" fill="#66f4ff"/><rect x="56" y="39" width="9" height="15" rx="4" fill="#66f4ff"/>`,
      cap: `<path d="M20 31Q22 18 40 17Q58 18 60 31Z" fill="#ff63da"/><path d="M15 32Q39 28 65 34Q57 40 24 38Z" fill="#d947bb"/>`,
    }[selected.accessory];

    return `<svg class="${className}" viewBox="0 0 80 80" role="img" aria-label="Avatar personalizado">
      <circle cx="40" cy="40" r="39" fill="#1b2449"/>
      <path d="M15 78Q17 57 40 57Q63 57 65 78" fill="#7c6de2"/>
      ${backHair}
      <ellipse cx="40" cy="41" rx="20" ry="24" fill="${skin}"/>
      ${hairShape}
      <path d="M31 43h1m16 0h1" stroke="#33243a" stroke-width="3" stroke-linecap="round"/>
      <path d="M35 52q5 4 10 0" fill="none" stroke="#a95762" stroke-width="2" stroke-linecap="round"/>
      ${accessory}
    </svg>`;
  }

  window.GameAvatar = { choices, defaults, normalize, render };
})();
