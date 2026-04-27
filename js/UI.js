export class UI {
    constructor() {
        this.dateDisplay = document.getElementById('date-display');
        this.eventLog = document.getElementById('event-log');
        this.tooltip = document.getElementById('tooltip');
        this.tooltipValue = document.getElementById('tooltip-value');
        this.btnPlayPause = document.getElementById('btn-playpause');
        this.btnSpeedDown = document.getElementById('btn-speed-down');
        this.btnSpeedUp = document.getElementById('btn-speed-up');
        this.speedDisplay = document.getElementById('speed-display');
        this.timeSlider = document.getElementById('time-slider');
        this.magFilter = document.getElementById('mag-filter');
        
        this.isDraggingSlider = false;
        this.lastLogSignature = "";
    }

    bindControls(environment) {
        if (!this.btnPlayPause || !this.timeSlider) return;

        this.btnPlayPause.addEventListener('click', () => {
            if (environment.currentDate && environment.endTime && environment.currentDate.getTime() >= environment.endTime.getTime()) {
                // 最後までいっていたら最初から再生する
                environment.currentDate = new Date(environment.startTime.getTime());
            }
            environment.isPaused = !environment.isPaused;
            this.btnPlayPause.innerText = environment.isPaused ? "▶ PLAY" : "⏸ PAUSE";
        });
        
        window.addEventListener('simulation-ended', () => {
            if (this.btnPlayPause) this.btnPlayPause.innerText = "▶ PLAY";
        });

        this.timeSlider.addEventListener('mousedown', () => { this.isDraggingSlider = true; });
        this.timeSlider.addEventListener('mouseup', () => { this.isDraggingSlider = false; });
        
        this.timeSlider.addEventListener('input', (e) => {
            if (environment.startTime && environment.endTime) {
                const ratio = parseFloat(e.target.value) / 1000.0;
                const newTime = environment.startTime.getTime() + ratio * (environment.endTime.getTime() - environment.startTime.getTime());
                environment.currentDate = new Date(newTime);
                this.updateDateDisplay(environment.currentDate);
            }
        });
        
        // 再生速度の調整
        let speedMultiplier = 1.0;
        const updateSpeed = () => {
            environment.timeSpeed = (24 * 60 * 60 * 1000) * speedMultiplier;
            if (this.speedDisplay) this.speedDisplay.innerText = speedMultiplier.toFixed(1) + "x";
        };

        if (this.btnSpeedDown) {
            this.btnSpeedDown.addEventListener('click', () => {
                // 0.1倍速まで落とせるように
                if (speedMultiplier <= 1.0) speedMultiplier = Math.max(0.1, speedMultiplier - 0.1);
                else speedMultiplier = Math.max(1.0, speedMultiplier - 1.0);
                updateSpeed();
            });
        }
        if (this.btnSpeedUp) {
            this.btnSpeedUp.addEventListener('click', () => {
                // 最大10倍速まで
                if (speedMultiplier < 1.0) speedMultiplier += 0.1;
                else speedMultiplier = Math.min(10.0, speedMultiplier + 1.0);
                updateSpeed();
            });
        }

        // キーボードでの時間操作（左で戻る、右で進む）
        window.addEventListener('keydown', (e) => {
            if (!environment.startTime || !environment.endTime) return;
            // シーク幅（30日）
            const skipMs = 30 * 24 * 60 * 60 * 1000;
            
            if (e.key === 'ArrowLeft') {
                const newTime = environment.currentDate.getTime() - skipMs;
                environment.currentDate = new Date(Math.max(environment.startTime.getTime(), newTime));
                this.updateDateDisplay(environment.currentDate);
            } else if (e.key === 'ArrowRight') {
                const newTime = environment.currentDate.getTime() + skipMs;
                environment.currentDate = new Date(Math.min(environment.endTime.getTime(), newTime));
                this.updateDateDisplay(environment.currentDate);
            } else if (e.key === ' ') {
                environment.isPaused = !environment.isPaused;
                if (this.btnPlayPause) this.btnPlayPause.innerText = environment.isPaused ? "▶ PLAY" : "⏸ PAUSE";
                e.preventDefault(); // スクロール防止
            }
        });
    }

    update(environment, seismicContext) {
        this.updateDateDisplay(environment.currentDate);

        if (!this.isDraggingSlider && environment.startTime && environment.endTime && this.timeSlider) {
            const total = environment.endTime.getTime() - environment.startTime.getTime();
            const current = environment.currentDate.getTime() - environment.startTime.getTime();
            if (total > 0) {
                this.timeSlider.value = (current / total) * 1000;
            }
        }
        
        if (seismicContext) {
            this.updateLog(seismicContext.earthquakes, environment.currentDate.getTime());
        }
    }

    updateLog(earthquakes, currentTime) {
        if (!this.eventLog || !this.magFilter) return;
        
        const filterMag = parseFloat(this.magFilter.value);
        
        // Find top 20 most recent earthquakes before currentTime matching filter
        const recentEqs = [];
        for (let i = earthquakes.length - 1; i >= 0; i--) {
            const eq = earthquakes[i];
            if (eq.time > currentTime) continue;
            if (eq.mag < filterMag) continue;
            recentEqs.push(eq);
            if (recentEqs.length >= 20) break;
        }
        
        if (recentEqs.length > 0) {
            const signature = recentEqs[0].time + "_" + filterMag;
            if (this.lastLogSignature === signature) return; // No change
            this.lastLogSignature = signature;
        } else {
            if (this.lastLogSignature === "empty") return;
            this.lastLogSignature = "empty";
        }

        this.eventLog.innerHTML = '';
        recentEqs.forEach(eq => {
            const li = document.createElement('li');
            const dateStr = new Date(eq.time).toISOString().split('T')[0];
            li.innerHTML = `<strong>M${eq.mag.toFixed(1)}</strong> [${dateStr}] Depth:${eq.depth}km`;
            if (eq.mag >= 7.0) {
                li.style.borderColor = '#ff0055';
                li.style.background = 'rgba(255, 0, 85, 0.2)';
            } else if (eq.mag >= 6.0) {
                li.style.borderColor = '#ffaa00';
                li.style.background = 'rgba(255, 170, 0, 0.2)';
            } else {
                li.className = 'minor';
            }
            this.eventLog.appendChild(li);
        });
    }

    updateDateDisplay(date) {
        if (this.dateDisplay) {
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            const hh = String(date.getHours()).padStart(2, '0');
            const min = String(date.getMinutes()).padStart(2, '0');
            const ss = String(date.getSeconds()).padStart(2, '0');
            this.dateDisplay.innerText = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
        }
    }

    updateTooltip(plateName, x, y) {
        if (plateName) {
            this.tooltip.style.display = 'block';
            this.tooltip.style.left = x + 'px';
            this.tooltip.style.top = y + 'px';
            this.tooltipValue.innerText = plateName;
        } else {
            this.tooltip.style.display = 'none';
        }
    }
}
