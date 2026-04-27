export class SeismicContext {
    constructor(mapContext) {
        this.mapContext = mapContext;
        this.earthquakes = [];
        this.eventListeners = [];
    }

    addEventListener(type, callback) {
        this.eventListeners.push({ type, callback });
    }

    dispatchEvent(event) {
        for (const listener of this.eventListeners) {
            if (listener.type === event.type) {
                listener.callback(event);
            }
        }
    }

    loadEarthquakes(data) {
        if (!data || !data.features) return;
        const isOptimized = data.optimized;

        data.features.forEach(f => {
            let lon, lat, mag, time, depthKm;

            if (isOptimized) {
                lon = f[0];
                lat = f[1];
                mag = f[2];
                time = f[3];
                depthKm = f.length > 4 ? f[4] : 10;
            } else {
                const props = f.properties;
                const coords = f.geometry.coordinates;
                lon = coords[0];
                lat = coords[1];
                mag = props.mag;
                time = props.time;
                depthKm = coords.length > 2 ? coords[2] : 10;
            }

            if (lat >= 20 && lat <= 50 && lon >= 120 && lon <= 150) {
                // M9.0を基準(1.0)とした絶対的なエネルギースケールに戻す（M4.5は本来の微小な値に）
                const stress = Math.pow(10, (mag - 9.0) * 0.5);
                
                const depthVisual = (Math.min(depthKm, 600) / 600.0) * 10.0;
                const pos = this.mapContext.lonLatToVector3(lon, lat);
                pos.addScaledVector(pos.clone().normalize(), -depthVisual);

                this.earthquakes.push({
                    time: time,
                    stress: stress,
                    mag: mag,
                    lon: lon,
                    lat: lat,
                    depth: depthKm,
                    pos: pos
                });
            }
        });

        this.earthquakes.sort((a, b) => a.time - b.time);
    }

    // デバッグ用のストレス注入
    injectStress(lon, lat, currentTimeMs) {
        const pos = this.mapContext.lonLatToVector3(lon, lat);
        const up = pos.clone().normalize();
        pos.addScaledVector(up, -1.0); // 浅い深度で注入

        this.earthquakes.push({
            time: currentTimeMs,
            stress: 0.5,
            mag: 5.0,
            lon: lon,
            lat: lat,
            depth: 15,
            pos: pos
        });
        this.earthquakes.sort((a, b) => a.time - b.time);
    }
}
