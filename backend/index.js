const backend = require("./app")

function createApp(options = {}) {
    return backend.createApp({
        ...options,
        legacyIotDataResponse: true,
    }).app
}

function calculateEsgEnvironmentScore({ airQuality, no2, noiseLevels }) {
    return Number(
        (
            100 -
            (Number(airQuality) * 0.5 +
                Number(no2) * 0.33 +
                Number(noiseLevels) * 0.17)
        ).toFixed(2)
    )
}

module.exports = {
    ...backend,
    createApp,
    calculateEsgEnvironmentScore,
}

if (require.main === module) {
    backend.startServer()
}
