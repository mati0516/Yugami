import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class Visualizer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        // Position camera to look at Japan (lat ~36, lon ~138).
        // x ~ -60, y ~ 58, z ~ -54
        this.camera.position.set(-60, 58, -54).normalize().multiplyScalar(150);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // limit pixel ratio for performance
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.02; // Slower damping
        this.controls.rotateSpeed = 0.5; // Lower sensitivity
        this.controls.panSpeed = 0.8;
        
        // 右クリックで移動（Pan）、左クリックで回転（Rotate）
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        
        // Set target to Japan center
        this.controls.target.set(-60, 58, -54).normalize().multiplyScalar(100);

        this.setupPostProcessing();
        
        this.plateMaterial = null;
        this.strainAttribute = null;

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line.threshold = 1.5; // Make lines easier to hover/click
        this.mouse = new THREE.Vector2();
        this.mouseX = 0;
        this.mouseY = 0;
        this.hoveredNodeIndex = -1;
        this.onNodeHover = null;
        this.onNodeClick = null;

        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('pointermove', this.onPointerMove.bind(this));
        window.addEventListener('click', this.onClick.bind(this));
    }

    setupPostProcessing() {
        // Neon effect (Bloom) disabled
    }

    initScene(japanGeo, plateGeo, roiGeo, graticuleGeo) {
        // ROI Bounding Box
        if (roiGeo) {
            const roiMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.2 });
            const roiLines = new THREE.LineSegments(roiGeo, roiMat);
            this.scene.add(roiLines);
        }

        // Graticule (Spherical Lat/Lon Grid)
        if (graticuleGeo) {
            const graticuleMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05 });
            const graticuleLines = new THREE.LineSegments(graticuleGeo, graticuleMat);
            this.scene.add(graticuleLines);
        }

        // Japan Map (Prominent foreground lines)
        const japanMat = new THREE.LineBasicMaterial({ color: 0xd0f0ff, transparent: true, opacity: 1.0 });
        const japanLines = new THREE.LineSegments(japanGeo, japanMat);
        this.scene.add(japanLines);

        const gridPoints = [];
        const minLat = 20, maxLat = 50, step = 0.2;
        const minLon = 120, maxLon = 150;
        
        // 深さは10kmまでとし、ステップを10kmとする（0kmと10kmの2層）
        const depthStep = 10, maxDepth = 10;

        for (let lat = minLat; lat <= maxLat; lat += step) {
            const phi = (90 - lat) * (Math.PI / 180);
            for (let lon = minLon; lon <= maxLon; lon += step) {
                const theta = (lon + 180) * (Math.PI / 180);
                const x0 = -(100 * Math.sin(phi) * Math.cos(theta));
                const z0 = (100 * Math.sin(phi) * Math.sin(theta));
                const y0 = (100 * Math.cos(phi));
                
                const upX = x0 / 100, upY = y0 / 100, upZ = z0 / 100;
                
                for (let d = 0; d <= maxDepth; d += depthStep) {
                    // 「感覚（視覚的なスケール）は20倍」を反映
                    // 実際の10kmを視覚的に20倍（200km相当の深さ）として描画
                    const depthVisual = (d / 600.0) * 10.0 * 20.0;
                    gridPoints.push(
                        x0 - upX * depthVisual,
                        y0 - upY * depthVisual,
                        z0 - upZ * depthVisual
                    );
                }
            }
        }
        
        const gridGeometry = new THREE.BufferGeometry();
        gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));

        // Point Cloud Shader (Voxel Node Energy Propagation)
        const vertexShader = `
            uniform vec3 eqPositions[150];
            uniform vec2 eqParams[150]; // x = stress, y = spread
            uniform vec3 eqDirs[150];   // プレートの沈み込み方向
            uniform int eqCount;
            
            varying float vStress;
            
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
                
                float totalStress = 0.0;
                
                for(int i=0; i<150; i++) {
                    if (i >= eqCount) break;
                    
                    float stress = eqParams[i].x;
                    float spread = eqParams[i].y;
                    
                    vec3 diff = worldPosition.xyz - eqPositions[i];
                    float d = length(diff);
                    d = max(d, 0.5); 
                    
                    vec3 dirToNode = normalize(diff);
                    float dotProduct = dot(dirToNode, eqDirs[i]);
                    
                    // dotProduct: 1.0 (プレートと同じ方向), -1.0 (逆方向)
                    // 強度の異方性：プレート方向は1.0倍（減衰なし）、逆方向は0.1倍に抑え込む
                    float directionalMultiplier = mix(0.1, 1.0, smoothstep(-0.5, 0.5, dotProduct));
                    
                    // 広がりの異方性：プレート方向に2.0倍伸び、逆方向には0.15倍に縮む
                    float directionalSpread = spread * mix(0.15, 2.0, smoothstep(-0.5, 0.5, dotProduct));
                    
                    // 距離による減衰を急激にし（分母を1.6 -> 0.5）、光が画面全体に広がりすぎるのを防止
                    totalStress += stress * exp(-d / (directionalSpread * 0.5)) * directionalMultiplier;
                }
                
                // バフが重なれば重なるほど倍率が跳ね上がる「重ね掛けコンボ効果」
                // 画面全体がピンクで埋め尽くされないよう、一定以上（0.3）の時だけ緩やかにかかるように抑制
                float comboBuff = 0.0;
                if (totalStress > 0.3) {
                    comboBuff = pow(totalStress, 1.5) * 0.5;
                }
                totalStress += comboBuff;
                
                vStress = totalStress;
                
                gl_PointSize = mix(1.0, 15.0, smoothstep(0.0, 1.0, totalStress));
                gl_PointSize *= (100.0 / length(worldPosition.xyz - cameraPosition));
            }
        `;

        const fragmentShader = `
            varying float vStress;
            
            void main() {
                float distToCenter = length(gl_PointCoord - vec2(0.5));
                if (distToCenter > 0.5) discard;
                
                float core = smoothstep(0.5, 0.0, distToCenter);
                
                vec3 colorLow = vec3(0.0, 0.2, 0.5);
                vec3 colorMid = vec3(0.0, 0.8, 1.0);
                vec3 colorHigh = vec3(1.0, 0.5, 0.0);
                vec3 colorPeak = vec3(1.0, 0.0, 0.4);
                
                vec3 finalColor = mix(colorLow, colorMid, smoothstep(0.0, 0.02, vStress));
                finalColor = mix(finalColor, colorHigh, smoothstep(0.02, 0.1, vStress));
                finalColor = mix(finalColor, colorPeak, smoothstep(0.1, 1.0, vStress));
                
                float intensity = 1.0 + (vStress * 2.0);
                
                float baseAlpha = 0.02 * core;
                float stressAlpha = smoothstep(0.001, 0.02, vStress) * 0.5 + smoothstep(0.02, 0.5, vStress) * 0.5;
                float alpha = max(baseAlpha, stressAlpha * core);
                
                gl_FragColor = vec4(finalColor * intensity, alpha);
            }
        `;

        this.uniforms = {
            eqPositions: { value: Array(150).fill(null).map(() => new THREE.Vector3()) },
            eqParams: { value: Array(150).fill(null).map(() => new THREE.Vector2()) },
            eqDirs: { value: Array(150).fill(null).map(() => new THREE.Vector3(0, -1, 0)) },
            eqCount: { value: 0 }
        };

        this.voxelGrid = new THREE.Points(gridGeometry, new THREE.ShaderMaterial({
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));
        this.scene.add(this.voxelGrid);

        // Surface Guide Lines (Conduits reference)
        if (plateGeo) {
            this.plateLines = new THREE.LineSegments(
                plateGeo,
                // 日本地図と同じくらいはっきり見せるため opacity: 1.0 に変更
                new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 1.0 })
            );
            this.scene.add(this.plateLines);
        }
    }

    updateStrain(earthquakes, environment) {
        if (!this.uniforms) return;
        
        const currentTime = environment.currentDate.getTime();
        const daysPerMs = 1.0 / (1000 * 60 * 60 * 24);

        if (!this.topEqsBuffer) {
            this.topEqsBuffer = Array(150).fill(null).map(() => ({ 
                pos: new THREE.Vector3(), remainingStress: 0, absStress: 0, depth: 0, mag: 0 
            }));
        }
        
        // 緯度20-50, 経度120-150の範囲を0.5度（約50km）メッシュで分割し、微小地震のストレスを空間的に合算する
        // (50 - 20) * 2 = 60, (150 - 120) * 2 = 60 -> 60x60 = 3600セル
        if (!this.clusterGrid) {
            this.clusterGrid = Array(3600).fill(null).map(() => ({ 
                active: false, x:0, y:0, z:0, stress:0, count:0, magMax:0, depthSum:0, lastTime:0 
            }));
        }
        
        // 毎フレームリセット
        for(let i=0; i<3600; i++) {
            this.clusterGrid[i].active = false;
        }
        
        let topCount = 0;
        
        // ループの進行方向から見て後に起きた巨大地震を保持
        // これも毎フレームnewせず使い回す
        if (!this.recentLargeEqs) this.recentLargeEqs = [];
        this.recentLargeEqs.length = 0; 
        
        // Loop backwards to find recent and impactful long-term events
        for (let i = earthquakes.length - 1; i >= 0; i--) {
            const eq = earthquakes[i];
            if (eq.time > currentTime) continue;
            
            const daysPassed = (currentTime - eq.time) * daysPerMs;
            
            // 蓄積効果のため、過去20年（7300日）のデータを保持
            if (daysPassed > 7300) {
                break;
            }
            
            // マグニチュードが高いほど衰退が早く、小さいほど長く残るロジック
            // M4.5で約20年（7300日）、M9.0で約5日で消えるスケール（プレ・スリップや歪みの蓄積を表現）
            const decayScale = 7300.0 / Math.pow(5.0, eq.mag - 4.5); 
            
            let remainingStress = 0.0;
            
            if (eq.mag >= 7.0 && daysPassed > decayScale) {
                // --- ストレスシャドウ（マイナスのデバフ）ロジック ---
                // 大地震は初期の発光期間（decayScale）を終えると、強力な「マイナスのストレス」へ反転する。
                // シェーダー上で周囲のバフ（正のストレス）を完全に吸収し、長期間発光を抑制する。
                const shadowDecay = Math.exp(-(daysPassed - decayScale) / 7300.0);
                const negativeScale = 1.0 - Math.exp(-(daysPassed - decayScale) / 50.0); // 50日で最大デバフへ
                // デバフはバフを完全に打ち消すため、通常のストレス値の50倍のマイナスパワーを持たせる
                remainingStress = -(eq.stress * negativeScale * shadowDecay) * 50.0;
            } else {
                // 通常のバフ（正のストレス）
                const decay = Math.exp(-daysPassed / decayScale);
                remainingStress = eq.stress * decay;
            }
            
            
            if (Math.abs(remainingStress) > 0.0001) {
                // 空間クラスタリング（合算）
                const latIdx = Math.max(0, Math.min(59, Math.floor((eq.lat - 20) * 2)));
                const lonIdx = Math.max(0, Math.min(59, Math.floor((eq.lon - 120) * 2)));
                const cIdx = latIdx * 60 + lonIdx;
                const cell = this.clusterGrid[cIdx];
                
                if (!cell.active) {
                    cell.active = true;
                    cell.x = 0; cell.y = 0; cell.z = 0;
                    cell.stress = 0; cell.count = 0; cell.magMax = 0; cell.depthSum = 0;
                    cell.lastTime = 0;
                }
                
                // 【群発コンボ（時間間隔）ロジック】
                // 同じセルで前回の地震（ループ上は未来の地震）との間隔が短いほど、バフの威力を増幅させる
                if (remainingStress > 0 && cell.lastTime > 0) {
                    const daysBetween = (cell.lastTime - eq.time) * daysPerMs;
                    if (daysBetween >= 0 && daysBetween < 30.0) {
                        // 30日以内の連続発生なら、間隔が短いほどバフが強力になる（最大5倍）
                        const rapidMultiplier = 1.0 + 4.0 * (1.0 - (daysBetween / 30.0));
                        remainingStress *= rapidMultiplier;
                    }
                }
                cell.lastTime = eq.time;
                
                cell.x += eq.pos.x;
                cell.y += eq.pos.y;
                cell.z += eq.pos.z;
                
                // ストレスを合算するが、数万件の余震で異常な数値（ピンク一色）になるのを防ぐためプラス方向は 1.0 にクランプする。
                // 逆にマイナス（デバフ）は圧倒的に強くするため、下限を -100.0 とし、バフを完全に封じ込める。
                cell.stress += remainingStress;
                if (cell.stress > 1.0) cell.stress = 1.0;
                if (cell.stress < -100.0) cell.stress = -100.0;
                
                cell.depthSum += eq.depth;
                cell.count++;
                if (eq.mag > cell.magMax) cell.magMax = eq.mag;
            }
        }
        
        // クラスタリングされたセルから上位150件を抽出
        for (let i = 0; i < 3600; i++) {
            const cell = this.clusterGrid[i];
            if (!cell.active) continue;
            
            const absStress = Math.abs(cell.stress);
            if (absStress < 0.0001) continue;
                
            // ゼロアロケーションの上位150件挿入ソート
            let insertIdx = -1;
            for(let k=0; k<topCount; k++) {
                if (absStress > this.topEqsBuffer[k].absStress) {
                    insertIdx = k;
                    break;
                }
            }
            
            if (insertIdx !== -1) {
                // シフト
                const moveEnd = Math.min(topCount, 149);
                for(let k=moveEnd; k>insertIdx; k--) {
                    this.topEqsBuffer[k].pos.copy(this.topEqsBuffer[k-1].pos);
                    this.topEqsBuffer[k].remainingStress = this.topEqsBuffer[k-1].remainingStress;
                    this.topEqsBuffer[k].absStress = this.topEqsBuffer[k-1].absStress;
                    this.topEqsBuffer[k].depth = this.topEqsBuffer[k-1].depth;
                    this.topEqsBuffer[k].mag = this.topEqsBuffer[k-1].mag;
                }
                this.topEqsBuffer[insertIdx].pos.set(cell.x / cell.count, cell.y / cell.count, cell.z / cell.count);
                this.topEqsBuffer[insertIdx].remainingStress = cell.stress;
                this.topEqsBuffer[insertIdx].depth = cell.depthSum / cell.count;
                this.topEqsBuffer[insertIdx].mag = cell.magMax;
                this.topEqsBuffer[insertIdx].absStress = absStress;
                if (topCount < 150) topCount++;
            } else if (topCount < 150) {
                this.topEqsBuffer[topCount].pos.set(cell.x / cell.count, cell.y / cell.count, cell.z / cell.count);
                this.topEqsBuffer[topCount].remainingStress = cell.stress;
                this.topEqsBuffer[topCount].depth = cell.depthSum / cell.count;
                this.topEqsBuffer[topCount].mag = cell.magMax;
                this.topEqsBuffer[topCount].absStress = absStress;
                topCount++;
            }
        }

        // Update uniforms
        this.uniforms.eqCount.value = topCount;
        for (let i = 0; i < 150; i++) {
            if (i < topCount) {
                const item = this.topEqsBuffer[i];
                this.uniforms.eqPositions.value[i].copy(item.pos);
                
                // プレートの沈み込み方向（西と下の中間）を計算
                const up = item.pos.clone().normalize();
                const north = new THREE.Vector3(0, 1, 0);
                const west = new THREE.Vector3().crossVectors(north, up).normalize();
                const plateDir = up.clone().multiplyScalar(-1).add(west).normalize();
                
                this.uniforms.eqDirs.value[i].copy(plateDir);
                
                // Spread factor: shallow = 1.0, deep (600km) = ~30.0
                let spread = Math.max(1.0, item.depth / 20.0);
                
                // 【玉突き拡大ロジック】
                // 蓄積されたプラスのストレスが一定値（0.1）を超えると、圧力で風船が膨らむように影響範囲が広がる
                if (item.remainingStress > 0.1) {
                    // ストレスが大きければ大きいほど広がる（画面全体が光らないよう最大拡大率を1.5倍程度に抑制）
                    const expansion = 1.0 + Math.min(0.5, (item.remainingStress - 0.1) * 0.5);
                    spread *= expansion;
                }
                
                // マイナスのデバフの場合、Mに応じて影響範囲を極端に広げる
                if (item.mag >= 7.0 && item.remainingStress < 0) {
                    const shadowRadiusMultiplier = Math.pow(2.5, item.mag - 7.0) * 2.0;
                    spread *= shadowRadiusMultiplier;
                }
                
                this.uniforms.eqParams.value[i].set(item.remainingStress, spread);
            } else {
                this.uniforms.eqParams.value[i].set(0.0, 1.0);
            }
        }
    }



    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    onPointerMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
    }

    onClick() {
        if (this.hoveredNodeIndex !== -1 && this.onNodeClick) {
            this.onNodeClick(this.hoveredNodeIndex);
        }
    }

    render() {
        this.controls.update();

        // Raycasting
        if (this.plateLines) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObject(this.plateLines);
            
            if (intersects.length > 0) {
                // Determine node index from vertex index
                const vertexIndex = intersects[0].index;
                const nodeIndex = Math.floor(vertexIndex / 2);
                
                if (this.hoveredNodeIndex !== nodeIndex) {
                    this.hoveredNodeIndex = nodeIndex;
                }
                
                if (this.onNodeHover) {
                    this.onNodeHover(this.hoveredNodeIndex, this.mouseX, this.mouseY);
                }
            } else {
                if (this.hoveredNodeIndex !== -1) {
                    this.hoveredNodeIndex = -1;
                    if (this.onNodeHover) {
                        this.onNodeHover(-1, this.mouseX, this.mouseY);
                    }
                }
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
}
