// ============================================================================
// Header mood configuration (built from the headerMoods / customMoods settings)
// ============================================================================

var BUILTIN_MOODS = {
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

// Ordered { name: { colors } } for the moods listed in headerMoods. The
// renderer validates the result and falls back to its defaults when empty.
function buildMoodConfig(settingsManager) {
    const headerMoods = settingsManager.get('headerMoods');
    const customMoods = settingsManager.get('customMoods');
    const all = Object.assign({}, BUILTIN_MOODS);
    if (customMoods && typeof customMoods === 'object') {
        for (const [key, value] of Object.entries(customMoods)) {
            if (!key.startsWith('_') && Array.isArray(value) && value.length > 0)
                all[key] = { colors: value.filter(c => typeof c === 'string') };
        }
    }
    const names = Array.isArray(headerMoods) ? headerMoods : Object.keys(BUILTIN_MOODS);
    const config = {};
    for (const name of names) {
        if (typeof name === 'string' && all[name])
            config[name] = all[name];
    }
    return config;
}
