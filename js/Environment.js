export class Environment {
    constructor() {
        this.currentDate = new Date('2024-01-01T00:00:00Z');
        this.timeSpeed = 24 * 60 * 60 * 1000; // 1 second = 1 day
        
        this.startTime = null;
        this.endTime = null;
        this.isPaused = false;
    }

    setEarthquakeData(data) {
        if (!data || !data.features || data.features.length === 0) return;
        
        let minT = Infinity;
        let maxT = -Infinity;
        
        const isOptimized = data.optimized;

        data.features.forEach(f => {
            const t = isOptimized ? f[3] : f.properties.time;
            if (t < minT) minT = t;
            if (t > maxT) maxT = t;
        });

        this.startTime = new Date(minT);
        this.endTime = new Date(maxT);
        this.currentDate = new Date(minT);
    }

    update(deltaTimeSeconds) {
        if (this.isPaused || !this.startTime || !this.endTime) return;

        // Advance time
        const newTime = this.currentDate.getTime() + deltaTimeSeconds * this.timeSpeed;
        
        if (newTime >= this.endTime.getTime()) {
            // 最後まで到達したらストップする
            this.currentDate = new Date(this.endTime.getTime());
            this.isPaused = true;
            
            // UIのボタン表記を戻すためのイベントを発火
            window.dispatchEvent(new Event('simulation-ended'));
        } else {
            this.currentDate = new Date(newTime);
        }
    }
}
