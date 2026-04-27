# Project Yugami: High-Fidelity Web Simulation Specification

## 1. Concept & Ubiquitous Language
本プロジェクトは、ブラウザ上で動作するインタラクティブな3D地震予測シミュレーターである。日本列島周辺のプレートの状態を「バフ（蓄積）」と「回復」の動的なサイクルとして定義し、WebGLを用いて可視化する。

* **Strain (歪み)**: プレート間に蓄積されるエネルギー（`currentStress`）。
* **Buff (バフ)**: 外部要因（潮汐、気象、近隣地震）による歪み蓄積率の一時的な上昇。
* **Relaxation (回復)**: 地震後のエネルギー解放（余効変動）および時間経過による自然減衰。
* **Bounded Context**: 
    - `MapContext`: 地理データ（GeoJSON）の描画と座標変換。
    - `SeismicContext`: 歪み・回復・連鎖の物理演算ロジック。
    - `EnvironmentalContext`: 月齢・季節・天候によるグローバル変数管理。

## 2. Technical Stack & Optimization
* **Environment**: モダンブラウザで動作するWebアプリケーション（GitHub Pages対応）。
* **Engine**: Three.js (WebGL) + GSAP (Animation)。
* **Performance**: 
    - 60fpsを維持するため、プレート境界は `BufferGeometry` に集約。
    - 色変化や発光（Bloom）はシェーダー（GLSL）側で処理し、CPU負荷を軽減。
* **Data Sources**:
    - プレート境界: `fraxen/tectonicplates` (GeoJSON)
    - 地図データ: `Natural Earth` (ne_10m_land.json)
    - 地震履歴: `USGS Earthquake Catalog` (GeoJSON)

## 3. Core Domain Logic

### 3.1 Stress-Recovery Lifecycle
各プレートセグメント（Node）は独立した状態を持ち、以下の計算式に従う。
* **Accumulation**: `currentStress += (baseAccumulationRate * activeBuffs)`
* **Recovery**: 地震発生直後、`recoveryRate` が最大化。統計データ（指数関数的減衰）に基づき `currentStress` を減少させる。

### 3.2 The Multi-Layered Buff System
1.  **Tidal Buff (天体)**: 
    - 月齢 0 (新月) または 15 (満月) の前後、蓄積率を +15% 補正。
2.  **Weather/Seasonal Buff (気象)**: 
    - 1月〜3月: 日本海側セグメントに積雪による「荷重バフ」を適用。
    - 豪雨イベント: 水圧上昇をシミュレートし、摩擦係数低下バフを時間差で付与。
3.  **Proximity & Depth Buff (連鎖)**: 
    - 地震発生時、距離 $1/d^2$ で周辺へストレスを即時伝播。
    - 深さ (<30km): 局所的な強烈ダメージ。
    - 深さ (>100km): プレート全体の蓄積レートを底上げする広域活性化。

## 4. Visual Experience & Interaction
* **Dynamic Visuals**: 
    - `currentStress` に同期して Blue -> Orange -> Red へ遷移。
    - 臨界点付近で発光が脈打つ（Pulsing）演出。
* **Interaction Control**: 
    - マウスホバーは「データの読み取り（歪み量の表示）」に限定。
    - クリック操作はデバッグ用の「ストレス注入バフ」として定義（勝手な破壊を防止）。
* **Dashboard**: 月齢アイコン、季節インジケーター、予測確信度ヒートマップを表示。

## 5. Deployment
* **Structure**: `index.html`, `main.js`, `style.css` および `/data` フォルダ。
* **License**: MIT License