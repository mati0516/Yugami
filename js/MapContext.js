import * as THREE from 'three';

export class MapContext {
    constructor() {
        this.plateGeometry = null;
        this.japanGeometry = null;
        this.nodeCoordinates = []; // to store lat/lon or xyz for each node
    }

    async load() {
        try {
            const [platesRes, japanRes] = await Promise.all([
                fetch('data/plates.geojson').then(r => r.json()),
                fetch('data/japan.geojson').then(r => r.json())
            ]);

            this.plateGeometry = this.parseGeoJSON(platesRes, true);
            this.japanGeometry = this.parseGeoJSON(japanRes, false);
        } catch (e) {
            console.error("Failed to load GeoJSON", e);
            // Create dummy geometry if loading fails (for testing)
            this.createDummyData();
        }
    }

    lonLatToVector3(lon, lat, radius = 100) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);

        const x = -(radius * Math.sin(phi) * Math.cos(theta));
        const z = (radius * Math.sin(phi) * Math.sin(theta));
        const y = (radius * Math.cos(phi));

        return new THREE.Vector3(x, y, z);
    }

    parseGeoJSON(data, isPlates) {
        const points = [];
        
        const minLat = 20, maxLat = 50;
        const minLon = 120, maxLon = 150;
        
        // Extrusion parameters for fault planes
        // 600km is approx 9.4 units in our radius=100 scale (100 * 600 / 6371)
        const depthVisual = 10.0; 
        const divisions = 30;

        const processCoordinates = (coords, featureProps) => {
            for (let i = 0; i < coords.length - 1; i++) {
                const lon1 = coords[i][0];
                const lat1 = coords[i][1];
                const lon2 = coords[i+1][0];
                const lat2 = coords[i+1][1];

                const in1 = lat1 >= minLat && lat1 <= maxLat && lon1 >= minLon && lon1 <= maxLon;
                const in2 = lat2 >= minLat && lat2 <= maxLat && lon2 >= minLon && lon2 <= maxLon;

                if (in1 || in2) {
                    const p1 = this.lonLatToVector3(lon1, lat1);
                    const p2 = this.lonLatToVector3(lon2, lat2);
                    
                    points.push(p1, p2);
                    
                    if (isPlates) {
                        const plateName = featureProps && featureProps.PlateA && featureProps.PlateB ? 
                                          `${featureProps.PlateA}-${featureProps.PlateB}` : 
                                          (featureProps && featureProps.Name ? featureProps.Name : 'Unknown');

                        this.nodeCoordinates.push({
                            lon: (lon1 + lon2) / 2, 
                            lat: (lat1 + lat2) / 2, 
                            vec: p1.clone().add(p2).multiplyScalar(0.5),
                            name: plateName
                        });
                    }
                }
            }
        };

        if (data && data.features) {
            data.features.forEach(feature => {
                if (feature.geometry.type === 'LineString') {
                    processCoordinates(feature.geometry.coordinates, feature.properties);
                } else if (feature.geometry.type === 'MultiLineString' || feature.geometry.type === 'Polygon') {
                    feature.geometry.coordinates.forEach(coords => {
                        processCoordinates(coords, feature.properties);
                    });
                } else if (feature.geometry.type === 'MultiPolygon') {
                    feature.geometry.coordinates.forEach(poly => {
                        poly.forEach(coords => processCoordinates(coords, feature.properties));
                    });
                }
            });
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return geometry;
    }

    createROIGeometry() {
        const minLat = 20, maxLat = 50;
        const minLon = 120, maxLon = 150;
        
        // We add some intermediate points to the horizontal/vertical lines 
        // to make them curve properly along the sphere surface.
        const points = [];
        const steps = 20;

        // Bottom edge (minLat)
        for(let i=0; i<steps; i++) {
            const lon1 = minLon + (maxLon - minLon) * (i/steps);
            const lon2 = minLon + (maxLon - minLon) * ((i+1)/steps);
            points.push(this.lonLatToVector3(lon1, minLat), this.lonLatToVector3(lon2, minLat));
        }
        // Top edge (maxLat)
        for(let i=0; i<steps; i++) {
            const lon1 = minLon + (maxLon - minLon) * (i/steps);
            const lon2 = minLon + (maxLon - minLon) * ((i+1)/steps);
            points.push(this.lonLatToVector3(lon1, maxLat), this.lonLatToVector3(lon2, maxLat));
        }
        // Left edge (minLon)
        for(let i=0; i<steps; i++) {
            const lat1 = minLat + (maxLat - minLat) * (i/steps);
            const lat2 = minLat + (maxLat - minLat) * ((i+1)/steps);
            points.push(this.lonLatToVector3(minLon, lat1), this.lonLatToVector3(minLon, lat2));
        }
        // Right edge (maxLon)
        for(let i=0; i<steps; i++) {
            const lat1 = minLat + (maxLat - minLat) * (i/steps);
            const lat2 = minLat + (maxLat - minLat) * ((i+1)/steps);
            points.push(this.lonLatToVector3(maxLon, lat1), this.lonLatToVector3(maxLon, lat2));
        }

        return new THREE.BufferGeometry().setFromPoints(points);
    }

    createGraticuleGeometry() {
        const points = [];
        const minLat = 20, maxLat = 50;
        const minLon = 120, maxLon = 150;
        
        // Latitudinal lines
        for (let lat = minLat; lat <= maxLat; lat += 5) {
            for (let lon = minLon; lon < maxLon; lon += 1) {
                points.push(this.lonLatToVector3(lon, lat));
                points.push(this.lonLatToVector3(lon + 1, lat));
            }
        }
        
        // Longitudinal lines
        for (let lon = minLon; lon <= maxLon; lon += 5) {
            for (let lat = minLat; lat < maxLat; lat += 1) {
                points.push(this.lonLatToVector3(lon, lat));
                points.push(this.lonLatToVector3(lon, lat + 1));
            }
        }
        
        return new THREE.BufferGeometry().setFromPoints(points);
    }

    createDummyData() {
        const geom = new THREE.WireframeGeometry(new THREE.SphereGeometry(100, 16, 16));
        this.japanGeometry = geom;
        this.plateGeometry = geom;
        const count = geom.attributes.position.count / 2;
        for(let i=0; i<count; i++) {
            this.nodeCoordinates.push({lon: 0, lat: 0, vec: new THREE.Vector3()});
        }
    }
}
