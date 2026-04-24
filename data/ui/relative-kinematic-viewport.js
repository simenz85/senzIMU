

export class RelativeKinematicViewport {
    constructor(options = {}) {
        this.options = options;
        this.rootId = options.rootId || 'relativKinematicTab';
        this.hostElement = document.getElementById(this.rootId);
        
        this.THREE = globalThis.THREE;
        this.initialized = false;
        this.visible = false;
        
        if (!this.THREE || !this.hostElement) {
            console.warn("RelativeKinematicViewport: THREE.js or host element missing");
            return;
        }

        this.initScene();
        this.initialized = true;
    }

    initScene() {
        this.hostElement.innerHTML = '';
        
        // Overlay for Text
        this.infoOverlay = document.createElement('div');
        this.infoOverlay.style.position = 'absolute';
        this.infoOverlay.style.top = '15px';
        this.infoOverlay.style.left = '15px';
        this.infoOverlay.style.color = '#fff';
        this.infoOverlay.style.fontSize = '15px';
        this.infoOverlay.style.pointerEvents = 'none';
        this.infoOverlay.style.textShadow = '1px 1px 3px rgba(0,0,0,0.8)';
        this.infoOverlay.style.background = 'rgba(11, 15, 25, 0.7)';
        this.infoOverlay.style.border = '1px solid rgba(255,255,255,0.1)';
        this.infoOverlay.style.padding = '18px 24px';
        this.infoOverlay.style.borderRadius = '8px';
        this.infoOverlay.style.zIndex = '1000';
        this.infoOverlay.style.minWidth = '280px';
        
        this.hostElement.appendChild(this.infoOverlay);
        this.hostElement.style.position = 'relative';

        // Overley for Amplify Slider
        this.amplifyControl = document.createElement('div');
        this.amplifyControl.style.position = 'absolute';
        this.amplifyControl.style.top = '15px';
        this.amplifyControl.style.right = '15px';
        this.amplifyControl.style.background = 'rgba(11, 15, 25, 0.7)';
        this.amplifyControl.style.border = '1px solid rgba(255,255,255,0.1)';
        this.amplifyControl.style.padding = '8px 12px';
        this.amplifyControl.style.borderRadius = '8px';
        this.amplifyControl.style.color = '#fff';
        this.amplifyControl.style.display = 'flex';
        this.amplifyControl.style.alignItems = 'center';
        this.amplifyControl.style.gap = '10px';
        this.amplifyControl.style.zIndex = '1000';
        
        this.amplifyControl.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 2px;">
                    <span>Sichtbar</span>
                    <div style="display: flex; gap: 8px; font-size: 13px;">
                        <label style="color:#ff4757; cursor:pointer; display:flex; align-items:center;"><input type="checkbox" id="kinShowMaster" checked style="margin:0 4px 0 0;">Master</label>
                        <label style="color:#1e90ff; cursor:pointer; display:flex; align-items:center;"><input type="checkbox" id="kinShowNode" checked style="margin:0 4px 0 0;">Node</label>
                        <label style="color:#ffd600; cursor:pointer; display:flex; align-items:center;"><input type="checkbox" id="kinShowRel" checked style="margin:0 4px 0 0;">Relativ</label>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Hintergrund</span>
                    <select id="kinematicBgSelect" style="width: 100px; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px;">
                        <option value="steel">Steel</option>
                        <option value="dusk">Dusk</option>
                        <option value="aurora">Aurora</option>
                        <option value="ember">Ember</option>
                        <option value="noir">Noir</option>
                        <option value="lab">Lab (Hell)</option>
                    </select>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Darstellung</span>
                    <select id="kinematicStyleSelect" style="width: 100px; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px;">
                        <option value="sphere" selected>Kugeln</option>
                        <option value="box">Quader</option>
                        <option value="axes">Nur Pfeile</option>
                        <option value="trail">Nur Spur</option>
                    </select>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Visual <span id="kinematicAmpVal">50</span>x</span>
                    <input type="range" id="kinematicAmpSlider" min="1" max="100" value="50" style="width: 100px; cursor: ew-resize; margin: 0;">
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Abstand <span id="kinematicSpreadVal">1.5</span></span>
                    <input type="range" id="kinematicSpreadSlider" min="0" max="50" value="15" style="width: 100px; cursor: ew-resize; margin: 0;">
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Spur <span id="kinematicTrailVal">5</span>s</span>
                    <input type="range" id="kinematicTrailSlider" min="1" max="15" value="5" style="width: 100px; cursor: ew-resize; margin: 0;">
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Grid Alpha</span>
                    <input type="range" id="kinematicGridSlider" min="0" max="100" value="15" style="width: 100px; cursor: ew-resize; margin: 0;">
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Objekt Alpha</span>
                    <input type="range" id="kinematicObjAlphaSlider" min="10" max="100" value="70" style="width: 100px; cursor: ew-resize; margin: 0;">
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <span>Wireframe</span>
                    <input type="checkbox" id="kinematicWireframeToggle" style="margin: 0; cursor: pointer;">
                </div>
            </div>
        `;
        this.hostElement.appendChild(this.amplifyControl);

        this.amplifyFactor = 50;
        this.spreadDistance = 1.5;
        this.trailDuration = 5;
        this.showMaster = true;
        this.showNode = true;
        this.showRel = true;

        // Setup Bottom-Left Scale Legend
        this.scaleLegend = document.createElement('div');
        this.scaleLegend.style.position = 'absolute';
        this.scaleLegend.style.left = '10px';
        this.scaleLegend.style.bottom = '10px';
        this.scaleLegend.style.fontFamily = 'Segoe UI, Roboto, Helvetica, sans-serif';
        this.scaleLegend.style.fontSize = '14px';
        this.scaleLegend.style.color = 'rgba(255,255,255,0.8)';
        this.scaleLegend.style.background = 'rgba(0,0,0,0.4)';
        this.scaleLegend.style.padding = '4px 8px';
        this.scaleLegend.style.borderRadius = '4px';
        this.scaleLegend.style.border = '1px solid rgba(255,255,255,0.1)';
        this.scaleLegend.innerText = '1 Ring = 20 µm'; // Default for 50x start
        this.hostElement.appendChild(this.scaleLegend);
        
        const updateScaleLegend = () => {
            const ringDist_mm = 1.0 / this.amplifyFactor;
            if (ringDist_mm < 1) {
                this.scaleLegend.innerText = `Skala: 1 Ring = ${(ringDist_mm * 1000).toFixed(0)} µm`;
            } else {
                this.scaleLegend.innerText = `Skala: 1 Ring = ${ringDist_mm.toFixed(2)} mm`;
            }
        };
        // Initialer Aufruf
        updateScaleLegend();

        const attachToggle = (id, prop) => {
            const cb = this.amplifyControl.querySelector(id);
            if (cb) {
                cb.addEventListener('change', (e) => {
                    this[prop] = e.target.checked;
                });
            }
        };

        attachToggle('#kinShowMaster', 'showMaster');
        attachToggle('#kinShowNode', 'showNode');
        attachToggle('#kinShowRel', 'showRel');
        
        const ampSlider = this.amplifyControl.querySelector('#kinematicAmpSlider');
        const ampVal = this.amplifyControl.querySelector('#kinematicAmpVal');
        if (ampSlider && ampVal) {
            ampSlider.addEventListener('input', (e) => {
                this.amplifyFactor = parseInt(e.target.value);
                ampVal.textContent = this.amplifyFactor;
                updateScaleLegend();
            });
        }
        
        const spreadSlider = this.amplifyControl.querySelector('#kinematicSpreadSlider');
        const spreadVal = this.amplifyControl.querySelector('#kinematicSpreadVal');
        if (spreadSlider && spreadVal) {
            spreadSlider.addEventListener('input', (e) => {
                this.spreadDistance = parseInt(e.target.value) / 10.0;
                spreadVal.textContent = this.spreadDistance.toFixed(1);
            });
        }
        
        const trailSlider = this.amplifyControl.querySelector('#kinematicTrailSlider');
        const trailVal = this.amplifyControl.querySelector('#kinematicTrailVal');
        if (trailSlider && trailVal) {
            trailSlider.addEventListener('input', (e) => {
                this.trailDuration = parseInt(e.target.value);
                trailVal.textContent = this.trailDuration;
            });
        }

        this.scene = new this.THREE.Scene();
        this.camera = new this.THREE.PerspectiveCamera(45, this.hostElement.clientWidth / this.hostElement.clientHeight, 0.1, 100);
        this.camera.position.set(0, -6, 4);
        this.camera.up.set(0, 0, 1);

        this.renderer = new this.THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.hostElement.clientWidth, this.hostElement.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.hostElement.appendChild(this.renderer.domElement);

        const OrbitControlsCtor = this.THREE.OrbitControls || globalThis.OrbitControls;
        if (OrbitControlsCtor) {
            this.controls = new OrbitControlsCtor(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.1;
        }

        const ambientLight = new this.THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const dirLight = new this.THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, -10, 7);
        this.scene.add(dirLight);

        // Geometries
        this.geometries = {
            box: new this.THREE.BoxGeometry(1.2, 0.8, 0.4),
            sphere: new this.THREE.SphereGeometry(0.5, 32, 32)
        };
        const defaultGeo = this.geometries.sphere;
        this.currentStyle = 'sphere';
        
        // Circular Grid Helper (1 Ring = exakt 1 Einheit)
        this.gridHelper = this.createCircularGrid({
            radius: 50,
            rings: 50,
            divisions: 36,
            majorColor: 0x7cecff,
            minorColor: 0x238fb6,
            majorOpacity: 0.8,
            minorOpacity: 0.4,
        });
        
        this.gridHelper.position.set(0, 0, -1); // Slightly pushed back
        
        this.gridHelper.children.forEach(child => {
            child.userData.baseOpacity = child.material.opacity;
            child.material.opacity = child.userData.baseOpacity * (15 / 100);
            child.material.depthWrite = false;
        });

        this.scene.add(this.gridHelper);

        // Global Axes Helper (Zentrale Pfeile mit Beschriftung)
        this.globalAxes = new this.THREE.Group();
        this.globalAxes.position.set(0, 0, -1);
        
        const origin = new this.THREE.Vector3(0, 0, 0);
        const len = 1.5;
        const headLen = 0.3;
        const headW = 0.12;
        
        const axX = new this.THREE.ArrowHelper(new this.THREE.Vector3(1,0,0), origin, len, 0xff4757, headLen, headW);
        const axY = new this.THREE.ArrowHelper(new this.THREE.Vector3(0,1,0), origin, len, 0x2ed573, headLen, headW);
        const axZ = new this.THREE.ArrowHelper(new this.THREE.Vector3(0,0,1), origin, len, 0x1e90ff, headLen, headW);
        
        [axX, axY, axZ].forEach(ax => {
            ax.line.material.transparent = true; ax.line.material.opacity = 0.5;
            ax.cone.material.transparent = true; ax.cone.material.opacity = 0.8;
            ax.line.material.depthWrite = false; ax.cone.material.depthWrite = false;
        });

        this.globalAxes.add(axX, axY, axZ);

        const lblX = this.createAxisLabel('X', 0xff4757, new this.THREE.Vector3(len + 0.3, 0, 0), 0.28);
        const lblY = this.createAxisLabel('Y', 0x2ed573, new this.THREE.Vector3(0, len + 0.3, 0), 0.28);
        const lblZ = this.createAxisLabel('Z', 0x1e90ff, new this.THREE.Vector3(0, 0, len + 0.3), 0.28);
        this.globalAxes.add(lblX, lblY, lblZ);

        this.scene.add(this.globalAxes);

        const gridSlider = this.amplifyControl.querySelector('#kinematicGridSlider');
        if (gridSlider) {
            gridSlider.addEventListener('input', (e) => {
                const scalar = parseInt(e.target.value) / 100.0;
                this.gridHelper.children.forEach(child => {
                    if(child.material) {
                        child.material.opacity = child.userData.baseOpacity * scalar;
                    }
                });
            });
        }
        
        const objAlphaSlider = this.amplifyControl.querySelector('#kinematicObjAlphaSlider');
        if (objAlphaSlider) {
            objAlphaSlider.addEventListener('input', (e) => {
                const alpha = parseInt(e.target.value) / 100.0;
                if(this.masterBox && this.masterBox.material) this.masterBox.material.opacity = alpha;
                if(this.sNodeBox && this.sNodeBox.material) this.sNodeBox.material.opacity = alpha;
                if(this.nodeBox && this.nodeBox.material) this.nodeBox.material.opacity = alpha;
            });
        }

        // Master Box (Hauptakteur 1, solide, starkes Rot)
        const masterMat = new this.THREE.MeshStandardMaterial({ color: 0xff4757, roughness: 0.3, transparent: true, opacity: 0.7 });
        this.masterBox = new this.THREE.Mesh(defaultGeo, masterMat);
        this.masterBox.position.set(1.5, 0, 0); // Rechts (Master)
        this.scene.add(this.masterBox);

        // Secondary Node Box (Hauptakteur 2, solide, starkes Blau)
        const sNodeMat = new this.THREE.MeshStandardMaterial({ color: 0x1e90ff, roughness: 0.3, transparent: true, opacity: 0.7 });
        this.sNodeBox = new this.THREE.Mesh(defaultGeo, sNodeMat);
        this.sNodeBox.position.set(-1.5, 0, 0); // Links (Node)
        this.scene.add(this.sNodeBox);

        // Relative Box (Die reine Differenz, JETZT AUCH SOLIDE)
        const relMat = new this.THREE.MeshStandardMaterial({ color: 0xffd600, transparent: true, opacity: 0.7, wireframe: false });
        this.nodeBox = new this.THREE.Mesh(defaultGeo, relMat);
        this.nodeBox.position.set(0, 0, 0); // Mitte (Relativ)
        this.scene.add(this.nodeBox);
        
        const wireframeToggle = this.amplifyControl.querySelector('#kinematicWireframeToggle');
        if (wireframeToggle) {
            wireframeToggle.addEventListener('change', (e) => {
                const isWireframe = e.target.checked;
                if(this.masterBox && this.masterBox.material) this.masterBox.material.wireframe = isWireframe;
                if(this.sNodeBox && this.sNodeBox.material) this.sNodeBox.material.wireframe = isWireframe;
                if(this.nodeBox && this.nodeBox.material) this.nodeBox.material.wireframe = isWireframe;
            });
        }
        
        // Ensure axes visibility is correctly synced to default 'sphere' style initially
        const axesHelperM = new this.THREE.AxesHelper(1); axesHelperM.visible = false;
        const axesHelperS = new this.THREE.AxesHelper(1); axesHelperS.visible = false;
        const axesHelperR = new this.THREE.AxesHelper(1); axesHelperR.visible = false;

        this.masterBox.add(axesHelperM);
        this.sNodeBox.add(axesHelperS);
        this.nodeBox.add(axesHelperR);

        // Bind Background Logic
        const presets = this.getBackgroundPresets();
        this.hostElement.style.background = presets.steel; // Init default

        const bgSelect = this.amplifyControl.querySelector('#kinematicBgSelect');
        if (bgSelect) {
            bgSelect.addEventListener('change', (e) => {
                this.hostElement.style.background = presets[e.target.value] || presets.steel;
            });
        }

        // Bind Style Logic
        const styleSelect = this.amplifyControl.querySelector('#kinematicStyleSelect');
        if (styleSelect) {
            styleSelect.addEventListener('change', (e) => {
                this.currentStyle = e.target.value;
                
                const showMeshes = (this.currentStyle === 'box' || this.currentStyle === 'sphere');
                this.masterBox.material.visible = showMeshes;
                this.sNodeBox.material.visible = showMeshes;
                this.nodeBox.material.visible = showMeshes;
                
                if (showMeshes) {
                     this.masterBox.geometry = this.geometries[this.currentStyle];
                     this.sNodeBox.geometry = this.geometries[this.currentStyle];
                     this.nodeBox.geometry = this.geometries[this.currentStyle];
                }

                const toggleAxes = (obj, visible) => {
                     obj.children.forEach(c => {
                         if (c.type === 'AxesHelper') c.visible = visible;
                     });
                };
                
                const axesVisible = (this.currentStyle === 'axes' || this.currentStyle === 'box');
                toggleAxes(this.masterBox, axesVisible);
                toggleAxes(this.sNodeBox, axesVisible);
                toggleAxes(this.nodeBox, axesVisible);
            });
        }

        // Trail Buffers & Lines
        this.trailHistory = {
            master: [],
            sNode: [],
            relNode: []
        };
        
        const maxPoints = 50 * 15; // Assuming ~30-50 FPS * 15 seconds
        const createTrail = (color) => {
            const geo = new this.THREE.BufferGeometry();
            const positions = new Float32Array(maxPoints * 3);
            geo.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
            geo.setDrawRange(0, 0);
            const mat = new this.THREE.LineBasicMaterial({ color: color, linewidth: 2, transparent: true, opacity: 0.8 });
            const line = new this.THREE.Line(geo, mat);
            this.scene.add(line);
            return line;
        };

        this.masterTrail = createTrail(0xff4757);
        this.sNodeTrail = createTrail(0x1e90ff);
        this.relNodeTrail = createTrail(0xffd600);

        // Auto-Resize when container becomes visible
        const resizeObserver = new ResizeObserver(() => {
            if (this.visible) this.resize();
        });
        resizeObserver.observe(this.hostElement);
        
        this.resize();
        this.animate();
    }

    resize() {
        if (!this.initialized || !this.hostElement || !this.camera || !this.renderer) return;
        const width = this.hostElement.clientWidth;
        const height = this.hostElement.clientHeight;
        if (width === 0 || height === 0) return;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate() {
        if (this.visible && this.controls) {
            this.controls.update();
            
            // Konstante Bildschirmgröße für das Kamera-unabhängige Koordinatenkreuz
            if (this.globalAxes && this.camera) {
                // Die anfängliche Kamera-Distanz (0, -6, 4) zum Zentrum (0, 0, -1) ist ca. 7.8
                const dist = this.camera.position.distanceTo(this.globalAxes.position);
                const scale = dist / 7.81; 
                this.globalAxes.scale.set(scale, scale, scale);
            }
            
            this.renderer.render(this.scene, this.camera);
        }
        requestAnimationFrame(() => this.animate());
    }

    updateState(masterQuat, nodeQuat, masterPos, nodePos, hasSecond = true, refTimeSeconds = null) {
        if (!this.initialized || !this.visible) return;

        // Visibilities dynamisch toggeln basierend auf Checkboxen
        this.masterBox.visible = this.showMaster;
        this.sNodeBox.visible = hasSecond && this.showNode;
        this.nodeBox.visible = hasSecond && this.showRel;

        // Position Integration
        if (masterPos && nodePos) {
            // Absolute positionen
            const mX_mm = masterPos.x * 1000;
            const mY_mm = masterPos.y * 1000;
            const mZ_mm = masterPos.z * 1000;

            const nX_mm = nodePos.x * 1000;
            const nY_mm = nodePos.y * 1000;
            const nZ_mm = nodePos.z * 1000;

            // Relative Auslenkung
            const dX_mm = nX_mm - mX_mm;
            const dY_mm = nY_mm - mY_mm;
            const dZ_mm = nZ_mm - mZ_mm;
            
            // --- TRAIL HISTORY LOGIC ---
            const now = typeof refTimeSeconds === 'number' ? refTimeSeconds : (performance.now() / 1000);
            this.trailHistory.master.push({t: now, x: mX_mm, y: mY_mm, z: mZ_mm});
            if (hasSecond) {
                this.trailHistory.sNode.push({t: now, x: nX_mm, y: nY_mm, z: nZ_mm});
                this.trailHistory.relNode.push({t: now, x: dX_mm, y: dY_mm, z: dZ_mm});
            }
            
            const cutoff = now - this.trailDuration;
            const filterHistory = (arr) => {
                let shiftCount = 0;
                // Since array is time-ordered, break as soon as we hit valid times
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i].t > cutoff) break;
                    shiftCount++;
                }
                if (shiftCount > 0) arr.splice(0, shiftCount);
            };
            filterHistory(this.trailHistory.master);
            filterHistory(this.trailHistory.sNode);
            filterHistory(this.trailHistory.relNode);

            // --- RENDER TRAILS ---
            const amp = this.amplifyFactor || 1;
            const updateTrailGeometry = (line, historyArr, offsetX) => {
                const len = historyArr.length;
                if (len === 0) {
                    line.geometry.setDrawRange(0, 0);
                    return;
                }
                const positions = line.geometry.attributes.position.array;
                // Check bounds
                const limit = Math.min(len, positions.length / 3);
                for (let i = 0; i < limit; i++) {
                    const pt = historyArr[i];
                    positions[i * 3] = pt.x * amp + offsetX;
                    positions[i * 3 + 1] = pt.y * amp;
                    positions[i * 3 + 2] = pt.z * amp;
                }
                line.geometry.setDrawRange(0, limit);
                line.geometry.attributes.position.needsUpdate = true;
            };

            const spread = this.spreadDistance !== undefined ? this.spreadDistance : 1.5;
            updateTrailGeometry(this.masterTrail, this.trailHistory.master, spread);
            this.masterTrail.visible = this.showMaster;
            this.sNodeTrail.visible = hasSecond && this.showNode;
            this.relNodeTrail.visible = hasSecond && this.showRel;
            if (hasSecond) {
                updateTrailGeometry(this.sNodeTrail, this.trailHistory.sNode, -spread);  // Links
                updateTrailGeometry(this.relNodeTrail, this.trailHistory.relNode, 0);    // Mitte
            }
            
            // Visual offset with amplification and dynamic spread distance
            this.masterBox.position.set((mX_mm * amp) + spread, mY_mm * amp, mZ_mm * amp); // Rechts
            this.sNodeBox.position.set((nX_mm * amp) - spread, nY_mm * amp, nZ_mm * amp);  // Links
            this.nodeBox.position.set(dX_mm * amp, dY_mm * amp, dZ_mm * amp);          // Mitte

            this.masterBox.quaternion.identity();
            this.sNodeBox.quaternion.identity();
            this.nodeBox.quaternion.identity();

            // Helper function for UI representation
            const renderStack = (title, titleColor, icon, x, y, z) => `
                <div style="font-size:18px; margin-top:16px; margin-bottom:12px; color:${titleColor}; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px;">
                    <i class="${icon}" style="margin-right:6px;"></i>${title}
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size: 20px;">
                    <span style="color:#ff4757;">X:</span> 
                    <span style="font-weight:bold; color:#fff;">${x.toFixed(3)} mm</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size: 20px;">
                    <span style="color:#2ed573;">Y:</span> 
                    <span style="font-weight:bold; color:#fff;">${y.toFixed(3)} mm</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size: 20px;">
                    <span style="color:#1e90ff;">Z:</span> 
                    <span style="font-weight:bold; color:#fff;">${z.toFixed(3)} mm</span>
                </div>
            `;

            // Basis HTML (Abhängig von Toggles)
            let html = '';
            if (this.showMaster) {
                html += renderStack("Master Absolut", "rgba(255,170,170,1)", "fas fa-arrows-alt", mX_mm, mY_mm, mZ_mm);
            }

            // Node und Delta HTML (Nur wenn 2 Sensoren)
            if (hasSecond) {
                if (this.showNode) {
                    html += renderStack("Node Absolut", "rgba(0,255,255,1)", "fas fa-arrows-alt", nX_mm, nY_mm, nZ_mm);
                }
                if (this.showRel) {
                    html += renderStack("Relative Diff", "rgba(255,214,0,1)", "fas fa-ruler-combined", dX_mm, dY_mm, dZ_mm);
                }
            }

            this.infoOverlay.innerHTML = html;
        }
    }

    radToDeg(rad) {
        return rad * (180 / Math.PI);
    }

    createCircularGrid(options = {}) {
        const THREE = this.THREE;
        const radius = options.radius ?? 5;
        const rings = options.rings ?? 10;
        const divisions = options.divisions ?? 20;
        const majorColor = options.majorColor ?? 0x7cecff;
        const minorColor = options.minorColor ?? 0x238fb6;
        const majorOpacity = options.majorOpacity ?? 0.96;
        const minorOpacity = options.minorOpacity ?? 0.72;
        const majorVertices = [];
        const minorVertices = [];

        const pushCircle = (target, currentRadius, segments = 96) => {
            for (let index = 0; index < segments; index++) {
                const angleA = (index / segments) * Math.PI * 2;
                const angleB = ((index + 1) / segments) * Math.PI * 2;
                target.push(
                    Math.cos(angleA) * currentRadius, Math.sin(angleA) * currentRadius, 0,
                    Math.cos(angleB) * currentRadius, Math.sin(angleB) * currentRadius, 0,
                );
            }
        };

        const pushRadial = (target, angle) => {
            target.push(
                0, 0, 0,
                Math.cos(angle) * radius, Math.sin(angle) * radius, 0,
            );
        };

        for (let ringIndex = 1; ringIndex <= rings; ringIndex++) {
            const currentRadius = (radius / rings) * ringIndex;
            pushCircle(ringIndex === rings ? majorVertices : minorVertices, currentRadius);
        }

        for (let divisionIndex = 0; divisionIndex < divisions; divisionIndex++) {
            const angle = (divisionIndex / divisions) * Math.PI * 2;
            const isMajor = divisionIndex % 5 === 0;
            pushRadial(isMajor ? majorVertices : minorVertices, angle);
        }

        const createSegments = (vertices, color, opacity) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
            return new THREE.LineSegments(geometry, material);
        };

        const group = new THREE.Group();
        group.add(createSegments(minorVertices, minorColor, minorOpacity));
        group.add(createSegments(majorVertices, majorColor, majorOpacity));
        return group;
    }

    createAxisLabel(text, color, position, scale = 1.0) {
        const THREE = this.THREE;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 128;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = 'bold 70px "Segoe UI", Roboto, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        let colorStr = color;
        if (typeof color === 'number') {
            colorStr = `#${color.toString(16).padStart(6, '0')}`;
        }
        
        // Leichter Glow-Effekt / Border für bessere Lesbarkeit
        context.strokeStyle = 'rgba(0,0,0,0.6)';
        context.lineWidth = 8;
        context.strokeText(text, canvas.width / 2, canvas.height / 2 + 4);
        
        context.fillStyle = colorStr;
        context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.scale.set(scale * 2.5, scale * 1.25, 1);
        return sprite;
    }

    getBackgroundPresets() {
        return {
            aurora: 'radial-gradient(circle at 18% 16%, rgba(68, 188, 224, 0.36), rgba(7, 20, 29, 0) 36%), radial-gradient(circle at 82% 18%, rgba(21, 97, 197, 0.22), rgba(7, 20, 29, 0) 28%), linear-gradient(180deg, rgba(10, 24, 31, 0.98), rgba(5, 14, 18, 0.98))',
            dusk: 'linear-gradient(135deg, rgba(33, 58, 88, 0.96), rgba(73, 39, 92, 0.94) 48%, rgba(19, 20, 38, 0.98))',
            steel: 'linear-gradient(180deg, rgba(29, 39, 49, 0.98), rgba(11, 17, 24, 0.98))',
            ember: 'radial-gradient(circle at top, rgba(181, 87, 33, 0.34), rgba(42, 17, 18, 0) 34%), linear-gradient(180deg, rgba(34, 18, 20, 0.98), rgba(9, 10, 14, 0.98))',
            noir: 'linear-gradient(180deg, rgba(18, 18, 20, 0.99), rgba(7, 7, 8, 0.99))',
            lab: 'linear-gradient(180deg, rgba(244, 248, 251, 0.98), rgba(218, 226, 232, 0.96) 45%, rgba(171, 183, 194, 0.98))',
        };
    }

    setVisible(isVisible) {
        this.visible = isVisible;
        if (isVisible) {
            this.resize();
        }
    }
}
