import { Environment } from './Environment.js';
import { SeismicContext } from './SeismicContext.js';
import { MapContext } from './MapContext.js';
import { Visualizer } from './Visualizer.js';
import { UI } from './UI.js';

async function init() {
    const environment = new Environment();
    const ui = new UI();
    const visualizer = new Visualizer(document.getElementById('webgl-container'));
    
    const mapContext = new MapContext();
    await mapContext.load();

    const seismicContext = new SeismicContext(mapContext);

    // Fetch USGS data
    try {
        const res = await fetch('data/earthquakes.json');
        const eqData = await res.json();
        environment.setEarthquakeData(eqData);
        seismicContext.loadEarthquakes(eqData);
    } catch (e) {
        console.warn("Failed to load earthquake data", e);
    }

    const roiGeo = mapContext.createROIGeometry();
    const graticuleGeo = mapContext.createGraticuleGeometry();
    visualizer.initScene(mapContext.japanGeometry, mapContext.plateGeometry, roiGeo, graticuleGeo);

    // Bind events
    visualizer.onNodeHover = (nodeIndex, x, y) => {
        if (nodeIndex !== -1 && mapContext.nodeCoordinates[nodeIndex]) {
            const node = mapContext.nodeCoordinates[nodeIndex];
            ui.updateTooltip(node.name, x, y);
        } else {
            ui.updateTooltip(null);
        }
    };

    // Bind UI controls
    ui.bindControls(environment);

    // Main Loop
    let lastTime = performance.now();
    
    function animate(time) {
        requestAnimationFrame(animate);

        const delta = (time - lastTime) / 1000;
        lastTime = time;

        const safeDelta = Math.min(delta, 0.1);

        environment.update(safeDelta);
        ui.update(environment, seismicContext);
        
        visualizer.updateStrain(seismicContext.earthquakes, environment);
        visualizer.render();
    }

    animate(performance.now());
}

// Start
init().catch(console.error);
