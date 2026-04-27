const fs = require('fs');
const https = require('https');

const MIN_LAT = 20;
const MAX_LAT = 50;
const MIN_LON = 120;
const MAX_LON = 150;
const MIN_MAG = 2.0;
const START_TIME = '2011-01-01';
const END_TIME = new Date().toISOString().split('T')[0];

async function fetchEarthquakes() {
    let allEvents = [];
    let offset = 1;
    const limit = 20000;
    
    console.log(`Fetching earthquakes from ${START_TIME} to ${END_TIME} (M>=${MIN_MAG})...`);
    
    while (true) {
        const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${START_TIME}&endtime=${END_TIME}&minlatitude=${MIN_LAT}&maxlatitude=${MAX_LAT}&minlongitude=${MIN_LON}&maxlongitude=${MAX_LON}&minmagnitude=${MIN_MAG}&limit=${limit}&offset=${offset}&orderby=time-asc`;
        
        console.log(`Requesting offset ${offset}...`);
        
        const data = await new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
        
        if (!data.features || data.features.length === 0) {
            break;
        }
        
        allEvents = allEvents.concat(data.features);
        console.log(`Fetched ${data.features.length} events. Total so far: ${allEvents.length}`);
        
        if (data.features.length < limit) {
            break; // Reached the end
        }
        
        offset += limit;
    }
    
    console.log(`Finished fetching. Total events: ${allEvents.length}`);
    
    // Optimize data structure: [lon, lat, mag, time, depth]
    // If M < 6.1, we can omit depth to save a tiny bit more space, but keeping it is fine.
    // The user requested omitting depth for M < 6.1 to strictly minimize.
    const optimizedEvents = allEvents.map(f => {
        const coords = f.geometry.coordinates;
        const props = f.properties;
        const mag = props.mag;
        const time = props.time;
        const lon = Number(coords[0].toFixed(3));
        const lat = Number(coords[1].toFixed(3));
        const depth = coords.length > 2 ? Number(coords[2].toFixed(1)) : 10;
        
        if (mag >= 6.1) {
            return [lon, lat, Number(mag.toFixed(1)), time, depth];
        } else {
            return [lon, lat, Number(mag.toFixed(1)), time];
        }
    });
    
    const outputPath = 'data/earthquakes.json';
    fs.writeFileSync(outputPath, JSON.stringify({ optimized: true, features: optimizedEvents }));
    console.log(`Saved optimized JSON to ${outputPath} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

fetchEarthquakes().catch(console.error);
