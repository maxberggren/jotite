// ============================================================================
// Header moods: colour palettes for the per-character heading gradients
// (pure JavaScript, no GI imports)
// ============================================================================

var DEFAULT_MOODS = {
    metal: { colors: ['#4A5568', '#CBD5E0'] },
    cobalt: { colors: ['#1B4BC7', '#B7329E', '#C7A27E'] },
    fire: { colors: ['#FF4500', '#FFD700'] },
    forest: { colors: ['#228B22', '#90EE90'] },
    lava: { colors: ['#8B0000', '#FF4500'] },
    mint: { colors: ['#00C9A7', '#C7FFED'] },
    amber: { colors: ['#FF8C00', '#FFE4B5'] },
    ocean: { colors: ['#006994', '#63B8FF'] },
    solar: { colors: ['#FF6E3D', '#9C6ADE', '#A0E0C4'] },
    cryo: { colors: ['#8DF6F7', '#FF3A20', '#737E7D'] },
    stone: { colors: ['#708090', '#B0B8C0'] },
    ice: { colors: ['#00CED1', '#E0FFFF'] },
    purple: { colors: ['#6A0DAD', '#DA70D6'] },
    sunset: { colors: ['#FF6B6B', '#FFA07A'] },
    royal: { colors: ['#4169E1', '#B0C4DE'] },
    aurora: { colors: ['#08F7FE', '#FF477E', '#35012C'] },
    sunken: { colors: ['#4E9A8A', '#C97B28', '#1C2431'] },
    ghost: { colors: ['#B9F3E4', '#8B4970', '#5C4B3A'] },
    sulfur: { colors: ['#E5D300', '#2A2A2A', '#3D2B6D'] },
    velvet: { colors: ['#C8FF00', '#3F0038', '#A77D62'] },
    cicada: { colors: ['#C6B89E', '#73663F', '#7FD4D9'] },
    lunar: { colors: ['#C1440E', '#D6D0C8', '#193B69'] },
    tonic: { colors: ['#A1C349', '#A65A52', '#4E5861'] },
    ectoplasm: { colors: ['#8FF7A7', '#FF8F8F', '#4D4F59'] },
    polar: { colors: ['#CFE9F1', '#FF5A1F', '#442C23'] },
    chiaroscuro: { colors: ['#005466', '#D8785F', '#A58CA0'] },
    vanta: { colors: ['#0A0A0A', '#00FFD1', '#FF2F92'] },
    toxicvelvet: { colors: ['#C0FF04', '#5D001E', '#C49B66'] },
    bruise: { colors: ['#3E8E9D', '#472F62', '#F6B48F'] },
    bismuth: { colors: ['#F15BB5', '#333333', '#3E9EFF'] },
    ultralich: { colors: ['#58FF8C', '#4400A1', '#E7DEC2'] },
    paradox: { colors: ['#FF9C82', '#1D1A1A', '#D0FF45'] },
    hazmat: { colors: ['#F3FF00', '#EB3AC5', '#0B3B4F'] },
    feral: { colors: ['#FF9D00', '#36006C', '#6C775C'] },
};

// Number of gradient steps for a mood with 2..10 colours (the look Jotite
// always had). Moods with more colours get one step per colour per segment.
var GRADIENT_STEPS = 20;

// Parse '#RGB' or '#RRGGBB' into {r, g, b}, or null if invalid
function parseColor(hex) {
    if (typeof hex !== 'string') return null;
    let m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (m) {
        const v = parseInt(m[1], 16);
        return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    }
    m = /^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(hex.trim());
    if (m) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16) };
    return null;
}

function toHex({ r, g, b }) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Build the looping gradient (array of '#rrggbb') for a palette of colours.
// The gradient runs 0 -> 1 -> ... -> N-1 -> ... -> 1 -> 0 so it tiles
// seamlessly along a heading.
function buildGradient(colors) {
    const palette = colors.map(parseColor).filter(Boolean);
    if (palette.length === 0) return [];
    if (palette.length === 1) return [toHex(palette[0])];

    const numSegments = (palette.length - 1) * 2;
    const segmentSteps = Math.max(1, Math.floor(GRADIENT_STEPS / numSegments));
    const lerp = (a, b, t) => ({
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
    });
    const out = [];
    const segment = (from, to) => {
        for (let i = 0; i < segmentSteps; i++) {
            const ratio = i / (segmentSteps - 1 || 1);
            out.push(toHex(lerp(from, to, segmentSteps === 1 ? 0 : ratio)));
        }
    };
    for (let k = 0; k < palette.length - 1; k++) segment(palette[k], palette[k + 1]);
    for (let k = palette.length - 1; k > 0; k--) segment(palette[k], palette[k - 1]);
    return out;
}

// Validate a mood configuration and return an ordered list of
// {name, gradient}. Accepts {name: {colors: [...]}} or {name: [...]}.
// Moods without any valid colour are dropped; if nothing valid remains the
// default moods are used.
function normalizeMoods(moodConfig) {
    const build = (config) => {
        const out = [];
        if (!config || typeof config !== 'object') return out;
        for (const [name, value] of Object.entries(config)) {
            const colors = Array.isArray(value) ? value : (value && Array.isArray(value.colors) ? value.colors : null);
            if (!colors) continue;
            const gradient = buildGradient(colors);
            if (gradient.length > 0) out.push({ name, gradient });
        }
        return out;
    };
    const moods = build(moodConfig);
    return moods.length > 0 ? moods : build(DEFAULT_MOODS);
}
