export class AccVectorViewport {
    constructor(options = {}) {
        this.debugPrefix = '[ACC-3D]';
        this.options = options;
        this.root = document.getElementById(options.rootId || 'accVectorTab');
        this.viewport = document.getElementById(options.viewportId || 'accVectorViewport');
        this.resetButton = document.getElementById(options.resetButtonId || 'accVectorResetBtn');
        this.viewcube = document.getElementById(options.viewcubeId || 'accVectorViewcube');
        this.sourceButtons = {
            raw: document.getElementById(options.sourceRawButtonId || 'alignSourceRawBtn'),
            calibrated: document.getElementById(options.sourceCalibratedButtonId || 'alignSourceCalibratedBtn'),
            calibratedCut: document.getElementById(options.sourceCalibratedCutButtonId || 'alignSourceCalibratedCutBtn'),
            gyroToggle: document.getElementById(options.gyroToggleButtonId || 'alignGyroToggleBtn'),
        };

        this.sliderElements = {
            x: document.getElementById(options.sliderXId || 'alignRotX'),
            y: document.getElementById(options.sliderYId || 'alignRotY'),
            z: document.getElementById(options.sliderZId || 'alignRotZ'),
        };

        this.sliderInputElements = {
            x: document.getElementById(options.sliderXInputId || 'alignRotXInput'),
            y: document.getElementById(options.sliderYInputId || 'alignRotYInput'),
            z: document.getElementById(options.sliderZInputId || 'alignRotZInput'),
        };

        this.sliderValueElements = {
            x: document.getElementById(options.sliderXValueId || 'alignRotXValue'),
            y: document.getElementById(options.sliderYValueId || 'alignRotYValue'),
            z: document.getElementById(options.sliderZValueId || 'alignRotZValue'),
        };

        this.arrowOpacityElements = this.getArrowOpacityElements(options);
        this.axisColorElements = this.getAxisColorElements(options);
        this.vectorColorElements = this.getVectorColorElements(options);
        this.backgroundPresetElement = document.getElementById(options.backgroundPresetId || 'alignBackgroundPreset');

        this.rawValueElements = {
            x: document.getElementById(options.rawXId || 'alignRawX'),
            y: document.getElementById(options.rawYId || 'alignRawY'),
            z: document.getElementById(options.rawZId || 'alignRawZ'),
        };

        this.rotatedValueElements = {
            x: document.getElementById(options.rotatedXId || 'alignRotatedX'),
            y: document.getElementById(options.rotatedYId || 'alignRotatedY'),
            z: document.getElementById(options.rotatedZId || 'alignRotatedZ'),
        };

        this.gyroCard = document.getElementById(options.gyroCardId || 'alignGyroCard');
        this.gyroRotatedValueElements = {
            x: document.getElementById(options.gyroRotatedXId || 'alignGyroRotatedX'),
            y: document.getElementById(options.gyroRotatedYId || 'alignGyroRotatedY'),
            z: document.getElementById(options.gyroRotatedZId || 'alignGyroRotatedZ'),
        };
        this.gyroMagnitudeElements = {
            rotated: document.getElementById(options.gyroRotatedMagnitudeId || 'alignGyroRotatedMagnitude'),
        };

        this.magnitudeElements = {
            raw: document.getElementById(options.rawMagnitudeId || 'alignRawMagnitude'),
            rotated: document.getElementById(options.rotatedMagnitudeId || 'alignRotatedMagnitude'),
        };

        this.quaternionValueElements = {
            x: document.getElementById(options.quaternionXId || 'alignQuatX'),
            y: document.getElementById(options.quaternionYId || 'alignQuatY'),
            z: document.getElementById(options.quaternionZId || 'alignQuatZ'),
            w: document.getElementById(options.quaternionWId || 'alignQuatW'),
        };

        this.statusElement = document.getElementById(options.statusId || 'alignViewportStatus');

        this.THREE = globalThis.THREE;
        this.visible = false;
        this.rafId = null;
        this.lastRenderTime = 0;
        this.gyroMilliDegreesPerDegree = 1000;
        this.gyroRingFullScaleMdps = 180000;
        this.vectorScale = 1 / 450;
        this.gyroVectorScale = 1 / 900;
        this.latestVector = null;
        this.latestSamples = { raw: null, calibrated: null, calibratedCut: null };
        this.latestGyroVector = null;
        this.latestGyroSamples = { raw: null, calibrated: null, calibratedCut: null };
        this.baseQuaternion = null;
        this.rotationQuaternion = null;
        this.initialized = false;
        this.initError = null;
        this.resizeObserver = null;
        this.resizeFrameId = null;
        this.hasLoggedFirstSample = false;
        this.hasLoggedFirstFrame = false;
        this.sourceMode = 'raw';
        this.gyroVisible = true;
        this.arrowOpacity = { raw: 0.82, result: 0.88, world: 0.42, frame: 0.58 };
        this.arrowOpacityBindings = { raw: [], result: [], world: [], frame: [] };
        this.axisColors = { x: '#ff0000', y: '#00ff00', z: '#0000ff' };
        this.vectorColors = { raw: '#ffa000', result: '#00e5ff' };
        this.backgroundPreset = 'steel';

        this.boundHandleResize = this.handleResize.bind(this);
        this.boundHandleSliderInput = this.handleSliderInput.bind(this);
        this.boundHandleSliderCommit = this.handleSliderCommit.bind(this);
        this.boundHandleSliderTextInput = this.handleSliderTextInput.bind(this);
        this.boundHandleSliderTextCommit = this.handleSliderTextCommit.bind(this);
        this.boundHandleStepperClick = this.handleStepperClick.bind(this);
        this.boundHandleArrowOpacityInput = this.handleArrowOpacityInput.bind(this);
        this.boundHandleArrowOpacityCommit = this.handleArrowOpacityCommit.bind(this);
        this.boundHandleAxisColorInput = this.handleAxisColorInput.bind(this);
        this.boundHandleVectorColorInput = this.handleVectorColorInput.bind(this);
        this.boundHandleBackgroundPresetChange = this.handleBackgroundPresetChange.bind(this);
        this.boundResetRotation = this.resetRotation.bind(this);
        this.boundHandleViewcubeClick = this.handleViewcubeClick.bind(this);

        this.log('constructed', {
            rootPresent: Boolean(this.root),
            viewportPresent: Boolean(this.viewport),
            threePresent: Boolean(this.THREE),
        });
    }

    log(message, details) {
        if (details !== undefined) {
            console.log(`${this.debugPrefix} ${message}`, details);
            return;
        }

        console.log(`${this.debugPrefix} ${message}`);
    }

    warn(message, details) {
        if (details !== undefined) {
            console.warn(`${this.debugPrefix} ${message}`, details);
            return;
        }

        console.warn(`${this.debugPrefix} ${message}`);
    }

    getArrowOpacityElements(options = {}) {
        return {
            raw: {
                slider: document.getElementById(options.arrowOpacityRawSliderId || 'alignArrowOpacityRaw'),
                input: document.getElementById(options.arrowOpacityRawInputId || 'alignArrowOpacityRawInput'),
                value: document.getElementById(options.arrowOpacityRawValueId || 'alignArrowOpacityRawValue'),
            },
            result: {
                slider: document.getElementById(options.arrowOpacityResultSliderId || 'alignArrowOpacityResult'),
                input: document.getElementById(options.arrowOpacityResultInputId || 'alignArrowOpacityResultInput'),
                value: document.getElementById(options.arrowOpacityResultValueId || 'alignArrowOpacityResultValue'),
            },
            world: {
                slider: document.getElementById(options.arrowOpacityWorldSliderId || 'alignArrowOpacityWorld'),
                input: document.getElementById(options.arrowOpacityWorldInputId || 'alignArrowOpacityWorldInput'),
                value: document.getElementById(options.arrowOpacityWorldValueId || 'alignArrowOpacityWorldValue'),
            },
            frame: {
                slider: document.getElementById(options.arrowOpacityFrameSliderId || 'alignArrowOpacityFrame'),
                input: document.getElementById(options.arrowOpacityFrameInputId || 'alignArrowOpacityFrameInput'),
                value: document.getElementById(options.arrowOpacityFrameValueId || 'alignArrowOpacityFrameValue'),
            },
        };
    }

    getAxisColorElements(options = {}) {
        return {
            x: document.getElementById(options.axisColorXInputId || 'alignAxisColorX'),
            y: document.getElementById(options.axisColorYInputId || 'alignAxisColorY'),
            z: document.getElementById(options.axisColorZInputId || 'alignAxisColorZ'),
        };
    }

    getVectorColorElements(options = {}) {
        return {
            raw: document.getElementById(options.vectorColorRawInputId || 'alignVectorColorRaw'),
            result: document.getElementById(options.vectorColorResultInputId || 'alignVectorColorResult'),
        };
    }

    getAxisColorSwatches(axisName) {
        return Array.from(this.root?.querySelectorAll(`[data-axis-color-swatch="${axisName}"]`) || []);
    }

    getVectorColorSwatches(groupName) {
        return Array.from(this.root?.querySelectorAll(`[data-vector-color-swatch="${groupName}"]`) || []);
    }

    ensureElements() {
        this.root = document.getElementById(this.options.rootId || 'accVectorTab');
        this.viewport = document.getElementById(this.options.viewportId || 'accVectorViewport');
        this.resetButton = document.getElementById(this.options.resetButtonId || 'accVectorResetBtn');
        this.viewcube = document.getElementById(this.options.viewcubeId || 'accVectorViewcube');
        this.sourceButtons = {
            raw: document.getElementById(this.options.sourceRawButtonId || 'alignSourceRawBtn'),
            calibrated: document.getElementById(this.options.sourceCalibratedButtonId || 'alignSourceCalibratedBtn'),
            calibratedCut: document.getElementById(this.options.sourceCalibratedCutButtonId || 'alignSourceCalibratedCutBtn'),
            gyroToggle: document.getElementById(this.options.gyroToggleButtonId || 'alignGyroToggleBtn'),
        };

        this.sliderInputElements = {
            x: document.getElementById(this.options.sliderXInputId || 'alignRotXInput'),
            y: document.getElementById(this.options.sliderYInputId || 'alignRotYInput'),
            z: document.getElementById(this.options.sliderZInputId || 'alignRotZInput'),
        };

        this.arrowOpacityElements = this.getArrowOpacityElements(this.options);
        this.axisColorElements = this.getAxisColorElements(this.options);
        this.vectorColorElements = this.getVectorColorElements(this.options);
        this.backgroundPresetElement = document.getElementById(this.options.backgroundPresetId || 'alignBackgroundPreset');

        this.gyroCard = document.getElementById(this.options.gyroCardId || 'alignGyroCard');
        this.gyroRotatedValueElements = {
            x: document.getElementById(this.options.gyroRotatedXId || 'alignGyroRotatedX'),
            y: document.getElementById(this.options.gyroRotatedYId || 'alignGyroRotatedY'),
            z: document.getElementById(this.options.gyroRotatedZId || 'alignGyroRotatedZ'),
        };
        this.gyroMagnitudeElements = {
            rotated: document.getElementById(this.options.gyroRotatedMagnitudeId || 'alignGyroRotatedMagnitude'),
        };

        this.quaternionValueElements = {
            x: document.getElementById(this.options.quaternionXId || 'alignQuatX'),
            y: document.getElementById(this.options.quaternionYId || 'alignQuatY'),
            z: document.getElementById(this.options.quaternionZId || 'alignQuatZ'),
            w: document.getElementById(this.options.quaternionWId || 'alignQuatW'),
        };

        this.log('ensureElements', {
            rootPresent: Boolean(this.root),
            viewportPresent: Boolean(this.viewport),
            resetButtonPresent: Boolean(this.resetButton),
            viewcubePresent: Boolean(this.viewcube),
            rawSourceButtonPresent: Boolean(this.sourceButtons.raw),
            calibratedSourceButtonPresent: Boolean(this.sourceButtons.calibrated),
            calibratedCutSourceButtonPresent: Boolean(this.sourceButtons.calibratedCut),
            gyroToggleButtonPresent: Boolean(this.sourceButtons.gyroToggle),
            arrowOpacityRawPresent: Boolean(this.arrowOpacityElements.raw?.slider),
            arrowOpacityResultPresent: Boolean(this.arrowOpacityElements.result?.slider),
            arrowOpacityWorldPresent: Boolean(this.arrowOpacityElements.world?.slider),
            arrowOpacityFramePresent: Boolean(this.arrowOpacityElements.frame?.slider),
            axisColorXPresent: Boolean(this.axisColorElements.x),
            axisColorYPresent: Boolean(this.axisColorElements.y),
            axisColorZPresent: Boolean(this.axisColorElements.z),
            vectorColorRawPresent: Boolean(this.vectorColorElements.raw),
            vectorColorResultPresent: Boolean(this.vectorColorElements.result),
            backgroundPresetPresent: Boolean(this.backgroundPresetElement),
        });

        return Boolean(this.root && this.viewport);
    }

    ensureInitialized() {
        if (this.initialized) {
            this.log('ensureInitialized: already initialized');
            return true;
        }

        this.THREE = globalThis.THREE;
        this.log('ensureInitialized: start', {
            threePresent: Boolean(this.THREE),
            orbitControlsPresent: Boolean(this.THREE?.OrbitControls || globalThis.OrbitControls),
        });

        if (!this.THREE) {
            this.setStatus('Three.js nicht geladen');
            this.warn('ensureInitialized: THREE missing');
            return false;
        }

        if (!this.ensureElements()) {
            this.warn('ensureInitialized: required DOM elements missing');
            return false;
        }

        try {
            this.setupScene();
            this.bindEvents();
            this.setSourceMode(this.sourceMode, { silent: true });
            this.resetRotation();
            this.setAccelerationSamples({
                raw: { x: 0, y: 0, z: -1000 },
                calibrated: { x: 0, y: 0, z: -1000 },
                calibratedCut: { x: 0, y: 0, z: 0 },
            });
            this.setGyroSamples({
                calibrated: { x: 0, y: 0, z: 0 },
                calibratedCut: { x: 0, y: 0, z: 0 },
            });
            Object.keys(this.arrowOpacity).forEach((groupName) => {
                this.setArrowOpacity(groupName, this.arrowOpacity[groupName], { silent: true });
            });
            Object.keys(this.axisColors).forEach((axisName) => {
                this.setAxisColor(axisName, this.axisColors[axisName], { silent: true });
            });
            Object.keys(this.vectorColors).forEach((groupName) => {
                this.setVectorColor(groupName, this.vectorColors[groupName], { silent: true });
            });
            this.setGyroVisible(this.gyroVisible, { silent: true });
            this.initialized = true;
            this.initError = null;
            this.scheduleResize();
            this.log('ensureInitialized: success');
            return true;
        } catch (error) {
            this.initError = error;
            console.error('ACC vector viewport init failed:', error);
            this.setStatus('3D-Viewport konnte nicht initialisiert werden');
            return false;
        }
    }

    setupScene() {
        const THREE = this.THREE;
        const OrbitControlsCtor = THREE.OrbitControls || globalThis.OrbitControls;

        this.log('setupScene: begin');

        if (!OrbitControlsCtor) {
            throw new Error('OrbitControls not available');
        }

        this.scene = new THREE.Scene();
        this.scene.background = null;

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        this.camera.up.set(0, 0, 1);
        this.camera.position.set(4.8, -3.2, 5.2);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        const isMobile = (typeof window !== 'undefined' && typeof window.matchMedia === 'function') ? window.matchMedia("(max-width: 768px)").matches : false;
        const maxRatio = isMobile ? 1.25 : 2;
        this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, maxRatio));
        this.renderer.setClearAlpha(0);

        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }

        this.viewport.appendChild(this.renderer.domElement);
        this.applyBackgroundPreset(this.backgroundPreset, { silent: true });
        this.log('setupScene: renderer appended', {
            viewportWidth: this.viewport.clientWidth,
            viewportHeight: this.viewport.clientHeight,
            childCount: this.viewport.childElementCount,
        });

        this.controls = new OrbitControlsCtor(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 2.5;
        this.controls.maxDistance = 12;
        this.controls.target.set(0, 0, 0.35);

        const ambientLight = new THREE.HemisphereLight(0xeaffff, 0x081218, 0.92);
        this.scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
        keyLight.position.set(4, 6, 3);
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x1ec8ff, 0.9);
        fillLight.position.set(-3, 2, -4);
        this.scene.add(fillLight);

        this.circularGrid = this.createCircularGrid({
            radius: 5,
            rings: 10,
            divisions: 20,
            majorColor: 0x7cecff,
            minorColor: 0x238fb6,
            majorOpacity: 0.34,
            minorOpacity: 0.14,
        });
        this.worldAxesGroup = new THREE.Group();
        this.scene.add(this.worldAxesGroup);
        this.worldAxesGroup.add(this.circularGrid);

        const worldAxisX = this.createArrowMesh(new THREE.Vector3(1, 0, 0), 0xc62828, { length: 2.8, negativeLength: 2.8, shaftRadius: 0.014, headRadius: 0.055, headLength: 0.18, opacityGroup: 'world' });
        const worldAxisY = this.createArrowMesh(new THREE.Vector3(0, 1, 0), 0x2e7d32, { length: 2.8, negativeLength: 2.8, shaftRadius: 0.014, headRadius: 0.055, headLength: 0.18, opacityGroup: 'world' });
        const worldAxisZ = this.createArrowMesh(new THREE.Vector3(0, 0, 1), 0x1565c0, { length: 2.8, negativeLength: 2.8, shaftRadius: 0.014, headRadius: 0.055, headLength: 0.18, opacityGroup: 'world' });
        this.worldAxes = { x: worldAxisX, y: worldAxisY, z: worldAxisZ };
        this.worldAxesGroup.add(worldAxisX, worldAxisY, worldAxisZ);
        this.worldAxisLabels = {
            x: this.createAxisLabel('Xw', 0xff0000, new THREE.Vector3(3.1, 0.1, 0)),
            y: this.createAxisLabel('Yw', 0x00ff00, new THREE.Vector3(0.12, 3.1, 0)),
            z: this.createAxisLabel('Zw', 0x0000ff, new THREE.Vector3(0, 0.12, 3.1)),
        };
        this.worldAxesGroup.add(this.worldAxisLabels.x, this.worldAxisLabels.y, this.worldAxisLabels.z);

        this.rotatedFrameGroup = new THREE.Group();
        this.scene.add(this.rotatedFrameGroup);

        this.rotatedAxes = {
            x: this.createArrowMesh(new THREE.Vector3(1, 0, 0), 0xe53935, { length: 2.1, negativeLength: 2.1, shaftRadius: 0.018, headRadius: 0.07, headLength: 0.18, opacityGroup: 'frame' }),
            y: this.createArrowMesh(new THREE.Vector3(0, 1, 0), 0x43a047, { length: 2.1, negativeLength: 2.1, shaftRadius: 0.018, headRadius: 0.07, headLength: 0.18, opacityGroup: 'frame' }),
            z: this.createArrowMesh(new THREE.Vector3(0, 0, 1), 0x1e88e5, { length: 2.1, negativeLength: 2.1, shaftRadius: 0.018, headRadius: 0.07, headLength: 0.18, opacityGroup: 'frame' }),
        };
        this.rotatedFrameGroup.add(this.rotatedAxes.x, this.rotatedAxes.y, this.rotatedAxes.z);
        this.rotatedAxisLabels = {
            x: this.createAxisLabel('Xs', 0xff0000, new THREE.Vector3(2.32, 0.12, 0), 0.28),
            y: this.createAxisLabel('Ys', 0x00ff00, new THREE.Vector3(0.12, 2.32, 0), 0.28),
            z: this.createAxisLabel('Zs', 0x0000ff, new THREE.Vector3(0, 0.12, 2.32), 0.28),
        };
        this.rotatedFrameGroup.add(this.rotatedAxisLabels.x, this.rotatedAxisLabels.y, this.rotatedAxisLabels.z);

        this.boardMesh = new THREE.Mesh(
            new THREE.BoxGeometry(1.8, 1.1, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x314955, metalness: 0.18, roughness: 0.58 })
        );
        this.rotatedFrameGroup.add(this.boardMesh);

        const sensorCap = new THREE.Mesh(
            new THREE.BoxGeometry(0.32, 0.22, 0.32),
            new THREE.MeshStandardMaterial({ color: 0xffa11a, metalness: 0.16, roughness: 0.44 })
        );
        sensorCap.position.set(0.55, 0, 0.14);
        this.rotatedFrameGroup.add(sensorCap);

        this.rawVectorArrow = this.createArrowMesh(new THREE.Vector3(0, 0, 1), 0xffa000, { length: 1, shaftRadius: 0.08, headRadius: 0.2, headLength: 0.38, opacityGroup: 'raw' });
        this.rotatedVectorArrow = this.createArrowMesh(new THREE.Vector3(0, 0, 1), 0x00e5ff, { length: 1, shaftRadius: 0.08, headRadius: 0.2, headLength: 0.38, opacityGroup: 'result' });
        this.scene.add(this.rawVectorArrow);
        this.rotatedVectorArrow.position.set(0, 0, 0.03);
        this.scene.add(this.rotatedVectorArrow);

        this.gyroGroup = new THREE.Group();
        this.scene.add(this.gyroGroup);
        this.gyroRotatedRingSet = this.createGyroRingSet({
            labelColor: 0xb39cff,
            labelPosition: new THREE.Vector3(0.12, 0.34, 0.56),
            colors: { x: 0xffc0c0, y: 0xb9ffd1, z: 0xc2e2ff },
        });
        this.gyroGroup.add(this.gyroRotatedRingSet.group);

        this.baseQuaternion = new THREE.Quaternion();
        this.rotationQuaternion = new THREE.Quaternion();
        this.resize();
        this.log('setupScene: complete');
    }

    bindEvents() {
        globalThis.addEventListener('resize', this.boundHandleResize);

        Object.values(this.sliderElements).forEach((slider) => {
            if (slider) {
                slider.addEventListener('input', this.boundHandleSliderInput);
                slider.addEventListener('change', this.boundHandleSliderCommit);
            }
        });

        Object.values(this.sliderInputElements).forEach((input) => {
            if (input) {
                input.addEventListener('input', this.boundHandleSliderTextInput);
                input.addEventListener('change', this.boundHandleSliderTextCommit);
                input.addEventListener('blur', this.boundHandleSliderTextCommit);
            }
        });

        if (this.resetButton) {
            this.resetButton.addEventListener('click', this.boundResetRotation);
        }

        this.root?.querySelectorAll('.vector-align-stepper-btn').forEach((button) => {
            button.addEventListener('click', this.boundHandleStepperClick);
        });

        if (this.viewcube) {
            this.viewcube.addEventListener('click', this.boundHandleViewcubeClick);
        }

        Object.values(this.arrowOpacityElements).forEach((groupElements) => {
            if (groupElements?.slider) {
                groupElements.slider.addEventListener('input', this.boundHandleArrowOpacityInput);
            }

            if (groupElements?.input) {
                groupElements.input.addEventListener('input', this.boundHandleArrowOpacityInput);
                groupElements.input.addEventListener('change', this.boundHandleArrowOpacityCommit);
                groupElements.input.addEventListener('blur', this.boundHandleArrowOpacityCommit);
            }
        });

        Object.values(this.axisColorElements).forEach((input) => {
            if (!input) {
                return;
            }

            input.addEventListener('input', this.boundHandleAxisColorInput);
            input.addEventListener('change', this.boundHandleAxisColorInput);
        });

        Object.values(this.vectorColorElements).forEach((input) => {
            if (!input) {
                return;
            }

            input.addEventListener('input', this.boundHandleVectorColorInput);
            input.addEventListener('change', this.boundHandleVectorColorInput);
        });

        if (this.backgroundPresetElement) {
            this.backgroundPresetElement.addEventListener('change', this.boundHandleBackgroundPresetChange);
        }

        if (this.sourceButtons.raw) {
            this.sourceButtons.raw.addEventListener('click', () => this.setSourceMode('raw'));
        }

        if (this.sourceButtons.calibrated) {
            this.sourceButtons.calibrated.addEventListener('click', () => this.setSourceMode('calibrated'));
        }

        if (this.sourceButtons.calibratedCut) {
            this.sourceButtons.calibratedCut.addEventListener('click', () => this.setSourceMode('calibratedCut'));
        }

        if (this.sourceButtons.gyroToggle) {
            this.sourceButtons.gyroToggle.addEventListener('click', () => this.setGyroVisible(!this.gyroVisible));
        }

        if ('ResizeObserver' in globalThis && this.viewport) {
            this.resizeObserver = new ResizeObserver(() => {
                this.log('ResizeObserver fired');
                this.scheduleResize();
            });
            this.resizeObserver.observe(this.viewport);
        }

        this.log('bindEvents: complete', {
            resizeObserverEnabled: Boolean(this.resizeObserver),
        });
    }

    createArrowMesh(direction, color, options = {}) {
        const THREE = this.THREE;
        const length = options.length ?? 2.1;
        const negativeLength = Math.max(0, options.negativeLength ?? 0);
        const headLength = options.headLength ?? 0.24;
        const headRadius = options.headRadius ?? 0.11;
        const shaftRadius = options.shaftRadius ?? 0.045;
        const shaftLength = Math.max(0.001, length - headLength);
        const opacityGroup = options.opacityGroup || 'result';

        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0 });
        const group = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 18), material);
        const tail = negativeLength > 0
            ? new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 18), material)
            : null;
        const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 24), material);

        shaft.position.y = shaftLength / 2;
        shaft.scale.y = shaftLength;
        if (tail) {
            tail.position.y = -negativeLength / 2;
            tail.scale.y = negativeLength;
        }
        head.position.y = shaftLength + headLength / 2;

        group.add(shaft);
        if (tail) {
            group.add(tail);
        }
        group.add(head);

        group.userData = {
            shaft,
            tail,
            head,
            material,
            headLength,
            shaftLength,
            negativeLength,
            direction: direction.clone().normalize(),
            opacityGroup,
        };

        if (!Array.isArray(this.arrowOpacityBindings[opacityGroup])) {
            this.arrowOpacityBindings[opacityGroup] = [];
        }

        this.arrowOpacityBindings[opacityGroup].push(material);
        this.applyArrowOpacity(opacityGroup);

        this.setArrowVector(group, direction, length);
        return group;
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

    createGyroRingSet(options = {}) {
        const THREE = this.THREE;
        const group = new THREE.Group();

        const axes = {
            x: this.createGyroAxisRing({ axis: 'x', color: options.colors?.x || 0xff6b6b }),
            y: this.createGyroAxisRing({ axis: 'y', color: options.colors?.y || 0x66d17a }),
            z: this.createGyroAxisRing({ axis: 'z', color: options.colors?.z || 0x58a6ff }),
        };

        group.add(axes.x.group, axes.y.group, axes.z.group);

        return { group, axes };
    }

    createGyroAxisRing(options = {}) {
        const THREE = this.THREE;
        const axis = options.axis || 'x';
        const color = options.color || 0xffffff;
        const radius = options.radius || 0.58;
        const tube = options.tube || 0.018;
        const group = new THREE.Group();
        const axisDirection = axis === 'x'
            ? new THREE.Vector3(1, 0, 0)
            : axis === 'y'
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);

        const baseRing = new THREE.Mesh(
            new THREE.TorusGeometry(radius, tube, 18, 72),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false })
        );
        const activeRing = new THREE.Mesh(
            new THREE.TorusGeometry(radius, tube * 1.35, 18, 72, Math.PI * 0.12),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.98,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            })
        );

        const labelOffset = new THREE.Vector3(radius + 0.24, 0.02, 0);
        const label = this.createAxisLabel(axis.toUpperCase(), color, labelOffset, 0.16);

        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisDirection);

        group.add(baseRing, activeRing, label);

        return {
            group,
            axis,
            radius,
            tube,
            baseRing,
            activeRing,
            phase: 0,
            angularVelocity: 0,
            currentArc: Math.PI * 0.12,
        };
    }

    createAxisLabel(text, color, position, scale = 0.34) {
        const THREE = this.THREE;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 128;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = 'bold 60px Segoe UI';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.scale.set(scale * 2, scale, 1);
        sprite.userData.text = text;
        sprite.userData.baseScale = scale;
        return sprite;
    }

    setArrowVector(arrow, direction, length) {
        const THREE = this.THREE;
        const normalized = direction.clone().normalize();
        const data = arrow.userData;
        const shaftLength = Math.max(0.001, length - data.headLength);

        data.shaft.scale.y = shaftLength;
        data.shaft.position.y = shaftLength / 2;
        if (data.tail) {
            data.tail.scale.y = data.negativeLength;
            data.tail.position.y = -data.negativeLength / 2;
        }
        data.head.position.y = shaftLength + data.headLength / 2;
        data.direction.copy(normalized);
        data.currentLength = length;

        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalized);
    }

    handleResize() {
        this.log('handleResize', { visible: this.visible });
        if (this.visible) {
            this.scheduleResize();
        }
    }

    handleViewcubeClick(event) {
        const button = event.target?.closest?.('[data-view]');
        if (!button) {
            return;
        }

        const direction = button.dataset.view;
        if (!direction) {
            return;
        }

        this.snapToView(direction);
    }

    handleSliderInput(event) {
        const axis = this.getAxisForSlider(event?.target);
        if (axis) {
            this.setSliderValue(axis, event.target.value);
        }

        this.updateRotation({ commit: false });
    }

    handleSliderCommit(event) {
        const axis = this.getAxisForSlider(event?.target);
        if (axis) {
            this.setSliderValue(axis, event.target.value);
        }

        this.updateRotation({ commit: true });
    }

    handleSliderTextInput(event) {
        const axis = this.getAxisForSliderTextInput(event?.target);
        if (!axis) {
            return;
        }

        const value = Number(event.target.value);
        if (!Number.isFinite(value)) {
            return;
        }

        this.setSliderValue(axis, value);
        this.updateRotation({ commit: false });
    }

    handleSliderTextCommit(event) {
        const axis = this.getAxisForSliderTextInput(event?.target);
        if (!axis) {
            return;
        }

        const fallbackValue = Number(this.sliderElements[axis]?.value || 0);
        const value = Number(event.target.value);
        const nextValue = Number.isFinite(value) ? value : fallbackValue;
        this.setSliderValue(axis, nextValue);
        this.updateRotation({ commit: true });
    }

    handleStepperClick(event) {
        const button = event?.currentTarget;
        const axis = button?.dataset?.axis;
        const step = Number(button?.dataset?.step || 0);
        if (!axis || !Number.isFinite(step) || step === 0) {
            return;
        }

        const currentValue = Number(this.sliderElements[axis]?.value || 0);
        this.setSliderValue(axis, currentValue + step);
        this.updateRotation({ commit: true });
    }

    handleArrowOpacityInput(event) {
        const opacityGroup = event?.target?.dataset?.opacityGroup;
        const numericValue = Number(event?.target?.value);
        if (!opacityGroup || !Number.isFinite(numericValue)) {
            return;
        }

        this.setArrowOpacity(opacityGroup, numericValue / 100, { silent: true });
    }

    handleArrowOpacityCommit(event) {
        const opacityGroup = event?.target?.dataset?.opacityGroup;
        if (!opacityGroup) {
            return;
        }

        const fallbackPercent = Math.round((this.arrowOpacity[opacityGroup] ?? 0.5) * 100);
        const numericValue = Number(event?.target?.value);
        const nextPercent = Number.isFinite(numericValue) ? numericValue : fallbackPercent;
        this.setArrowOpacity(opacityGroup, nextPercent / 100, { silent: true });
    }

    handleAxisColorInput(event) {
        const colorGroup = event?.target?.dataset?.axisColor;
        const colorValue = event?.target?.value;
        if (!colorGroup) {
            return;
        }

        this.setAxisColor(colorGroup, colorValue, { silent: true });
    }

    handleVectorColorInput(event) {
        const colorGroup = event?.target?.dataset?.vectorColor;
        const colorValue = event?.target?.value;
        if (!colorGroup) {
            return;
        }

        this.setVectorColor(colorGroup, colorValue, { silent: true });
    }

    handleBackgroundPresetChange(event) {
        this.setBackgroundPreset(event?.target?.value);
    }

    resetRotation() {
        this.setSliderValue('x', 0);
        this.setSliderValue('y', 0);
        this.setSliderValue('z', 0);
        this.updateRotation({ commit: true });
    }

    setArrowOpacity(groupName, value, options = {}) {
        if (!groupName || !(groupName in this.arrowOpacity)) {
            return;
        }

        const normalizedOpacity = this.normalizeArrowOpacity(groupName, value);
        this.arrowOpacity[groupName] = normalizedOpacity;
        const groupElements = this.arrowOpacityElements[groupName] || {};

        const percentValue = String(Math.round(normalizedOpacity * 100));
        if (groupElements.slider) {
            groupElements.slider.value = percentValue;
        }

        if (groupElements.input) {
            groupElements.input.value = percentValue;
        }

        if (groupElements.value) {
            groupElements.value.textContent = `${percentValue}%`;
        }

        this.applyArrowOpacity(groupName);

        if (!options.silent) {
            this.log('arrow opacity changed', { groupName, opacity: normalizedOpacity });
            this.emitDisplaySettingsChange();
        }
    }

    normalizeArrowOpacity(groupName, value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return this.arrowOpacity[groupName] ?? 0.5;
        }

        return Math.min(1, Math.max(0.15, numericValue));
    }

    applyArrowOpacity(groupName) {
        const materials = this.arrowOpacityBindings[groupName];
        if (!Array.isArray(materials) || materials.length === 0) {
            return;
        }

        const opacity = this.arrowOpacity[groupName] ?? 0.5;
        materials.forEach((material) => {
            if (!material) {
                return;
            }

            material.opacity = Math.min(1, Math.max(0.08, opacity));
        });
    }

    setAxisColor(axisName, colorValue, options = {}) {
        if (!axisName || !(axisName in this.axisColors)) {
            return;
        }

        const normalizedColor = this.normalizeAxisColor(axisName, colorValue);
        this.axisColors[axisName] = normalizedColor;
        this.applyAxisColor(axisName);
        this.syncAxisColorControls(axisName);

        if (!options.silent) {
            this.log('axis color changed', { axisName, color: normalizedColor });
            this.emitDisplaySettingsChange();
        }
    }

    normalizeAxisColor(axisName, colorValue) {
        if (typeof colorValue !== 'string') {
            return this.axisColors[axisName] ?? '#ffffff';
        }

        const trimmedColor = colorValue.trim();
        if (/^#[0-9a-f]{6}$/i.test(trimmedColor)) {
            return trimmedColor.toLowerCase();
        }

        return this.axisColors[axisName] ?? '#ffffff';
    }

    applyAxisColor(axisName) {
        const colorValue = this.axisColors[axisName] ?? '#ffffff';
        const worldArrow = this.worldAxes?.[axisName]?.userData?.material;
        const frameArrow = this.rotatedAxes?.[axisName]?.userData?.material;

        if (worldArrow?.color) {
            worldArrow.color.set(colorValue);
        }

        if (frameArrow?.color) {
            frameArrow.color.set(colorValue);
        }

        this.updateAxisLabelColor(this.worldAxisLabels?.[axisName], colorValue);
        this.updateAxisLabelColor(this.rotatedAxisLabels?.[axisName], colorValue);
    }

    updateAxisLabelColor(labelSprite, colorValue) {
        if (!labelSprite?.userData?.text || !labelSprite?.position) {
            return;
        }

        const nextLabel = this.createAxisLabel(
            labelSprite.userData.text,
            Number.parseInt(colorValue.slice(1), 16),
            labelSprite.position.clone(),
            labelSprite.userData.baseScale || 0.34,
        );
        labelSprite.material.map.dispose();
        labelSprite.material.dispose();
        labelSprite.material = nextLabel.material;
    }

    syncAxisColorControls(axisName) {
        const colorValue = this.axisColors[axisName] ?? '#ffffff';
        const input = this.axisColorElements[axisName];
        if (input) {
            input.value = colorValue;
        }

        this.getAxisColorSwatches(axisName).forEach((swatch) => {
            swatch.style.background = colorValue;
        });
    }

    setVectorColor(groupName, colorValue, options = {}) {
        if (!groupName || !(groupName in this.vectorColors)) {
            return;
        }

        const normalizedColor = this.normalizeVectorColor(groupName, colorValue);
        this.vectorColors[groupName] = normalizedColor;
        this.applyVectorColor(groupName);
        this.syncVectorColorControls(groupName);

        if (!options.silent) {
            this.log('vector color changed', { groupName, color: normalizedColor });
            this.emitDisplaySettingsChange();
        }
    }

    normalizeVectorColor(groupName, colorValue) {
        if (typeof colorValue !== 'string') {
            return this.vectorColors[groupName] ?? '#ffffff';
        }

        const trimmedColor = colorValue.trim().toLowerCase();
        if (/^#[0-9a-f]{6}$/i.test(trimmedColor)) {
            return trimmedColor;
        }

        return this.vectorColors[groupName] ?? '#ffffff';
    }

    applyVectorColor(groupName) {
        const arrow = groupName === 'raw' ? this.rawVectorArrow : this.rotatedVectorArrow;
        const material = arrow?.userData?.material;
        const colorValue = this.vectorColors[groupName] ?? '#ffffff';
        if (material?.color) {
            material.color.set(colorValue);
        }
    }

    syncVectorColorControls(groupName) {
        const colorValue = this.vectorColors[groupName] ?? '#ffffff';
        const input = this.vectorColorElements[groupName];
        if (input) {
            input.value = colorValue;
        }

        this.getVectorColorSwatches(groupName).forEach((swatch) => {
            swatch.style.background = colorValue;
        });
    }

    getBackgroundPresets() {
        return {
            aurora: 'radial-gradient(circle at 18% 16%, rgba(68, 188, 224, 0.36), rgba(7, 20, 29, 0) 36%), radial-gradient(circle at 82% 18%, rgba(21, 97, 197, 0.22), rgba(7, 20, 29, 0) 28%), linear-gradient(180deg, rgba(10, 24, 31, 0.98), rgba(5, 14, 18, 0.98))',
            dusk: 'linear-gradient(135deg, rgba(33, 58, 88, 0.96), rgba(73, 39, 92, 0.94) 48%, rgba(19, 20, 38, 0.98))',
            steel: 'linear-gradient(180deg, rgba(29, 39, 49, 0.98), rgba(11, 17, 24, 0.98))',
            'steel-soft': 'linear-gradient(180deg, rgba(57, 71, 84, 0.98), rgba(27, 37, 46, 0.98))',
            'steel-light': 'linear-gradient(180deg, rgba(114, 129, 143, 0.98), rgba(70, 83, 95, 0.96) 48%, rgba(39, 48, 56, 0.98))',
            ember: 'radial-gradient(circle at top, rgba(181, 87, 33, 0.34), rgba(42, 17, 18, 0) 34%), linear-gradient(180deg, rgba(34, 18, 20, 0.98), rgba(9, 10, 14, 0.98))',
            polar: 'radial-gradient(circle at 22% 18%, rgba(214, 247, 255, 0.34), rgba(255, 255, 255, 0) 30%), linear-gradient(180deg, rgba(202, 226, 235, 0.98), rgba(108, 133, 149, 0.94) 58%, rgba(23, 34, 43, 0.98))',
            mint: 'radial-gradient(circle at 15% 15%, rgba(140, 255, 216, 0.28), rgba(0, 0, 0, 0) 28%), linear-gradient(145deg, rgba(15, 54, 52, 0.98), rgba(18, 28, 36, 0.96) 52%, rgba(7, 11, 16, 0.98))',
            sunrise: 'radial-gradient(circle at 50% 8%, rgba(255, 214, 125, 0.42), rgba(255, 214, 125, 0) 24%), linear-gradient(180deg, rgba(92, 123, 173, 0.98), rgba(222, 128, 92, 0.94) 54%, rgba(48, 24, 32, 0.98))',
            noir: 'linear-gradient(180deg, rgba(18, 18, 20, 0.99), rgba(7, 7, 8, 0.99))',
            lab: 'linear-gradient(180deg, rgba(244, 248, 251, 0.98), rgba(218, 226, 232, 0.96) 45%, rgba(171, 183, 194, 0.98))',
        };
    }

    normalizeBackgroundPreset(value) {
        const presets = this.getBackgroundPresets();
        if (typeof value !== 'string') {
            return this.backgroundPreset in presets ? this.backgroundPreset : 'steel';
        }

        const normalized = value.trim().toLowerCase();
        return normalized in presets ? normalized : 'steel';
    }

    setBackgroundPreset(value, options = {}) {
        const normalizedPreset = this.normalizeBackgroundPreset(value);
        this.backgroundPreset = normalizedPreset;
        this.applyBackgroundPreset(normalizedPreset, { silent: true });

        if (!options.silent) {
            this.log('background preset changed', { preset: normalizedPreset });
            this.emitDisplaySettingsChange();
        }
    }

    applyBackgroundPreset(value, options = {}) {
        const normalizedPreset = this.normalizeBackgroundPreset(value);
        const presets = this.getBackgroundPresets();
        if (this.viewport) {
            this.viewport.style.background = presets[normalizedPreset] || presets.steel;
        }

        if (this.backgroundPresetElement) {
            this.backgroundPresetElement.value = normalizedPreset;
        }

        if (!options.silent) {
            this.emitDisplaySettingsChange();
        }
    }

    getDisplaySettings() {
        return {
            arrowOpacity: { ...this.arrowOpacity },
            axisColors: { ...this.axisColors },
            vectorColors: { ...this.vectorColors },
            backgroundPreset: this.backgroundPreset,
        };
    }

    applyDisplaySettings(settings = {}, options = {}) {
        const nextOpacity = settings?.arrowOpacity;
        if (nextOpacity && typeof nextOpacity === 'object') {
            Object.entries(nextOpacity).forEach(([groupName, value]) => {
                if (groupName in this.arrowOpacity) {
                    this.setArrowOpacity(groupName, value, { silent: true });
                }
            });
        }

        const nextAxisColors = settings?.axisColors;
        if (nextAxisColors && typeof nextAxisColors === 'object') {
            Object.entries(nextAxisColors).forEach(([axisName, value]) => {
                if (axisName in this.axisColors) {
                    this.setAxisColor(axisName, value, { silent: true });
                }
            });
        }

        const nextVectorColors = settings?.vectorColors;
        if (nextVectorColors && typeof nextVectorColors === 'object') {
            Object.entries(nextVectorColors).forEach(([groupName, value]) => {
                if (groupName in this.vectorColors) {
                    this.setVectorColor(groupName, value, { silent: true });
                }
            });
        }

        if (settings?.backgroundPreset) {
            this.setBackgroundPreset(settings.backgroundPreset, { silent: true });
        }

        if (!options.silent) {
            this.emitDisplaySettingsChange();
        }
    }

    emitDisplaySettingsChange() {
        if (typeof this.options.onDisplaySettingsChange === 'function') {
            this.options.onDisplaySettingsChange(this.getDisplaySettings());
        }
    }

    snapToView(direction) {
        if (!this.camera || !this.controls) {
            return;
        }

        const target = this.controls.target.clone();
        const distance = Math.max(this.camera.position.distanceTo(target), 4.8);
        const viewVectors = {
            front: new this.THREE.Vector3(0, -1, 0),
            back: new this.THREE.Vector3(0, 1, 0),
            right: new this.THREE.Vector3(1, 0, 0),
            left: new this.THREE.Vector3(-1, 0, 0),
            top: new this.THREE.Vector3(0, 0, 1),
            bottom: new this.THREE.Vector3(0, 0, -1),
        };

        const nextDirection = viewVectors[direction];
        if (!nextDirection) {
            return;
        }

        this.camera.position.copy(target).add(nextDirection.clone().multiplyScalar(distance));
        if (direction === 'top') {
            this.camera.up.set(0, 1, 0);
        } else if (direction === 'bottom') {
            this.camera.up.set(0, -1, 0);
        } else {
            this.camera.up.set(0, 0, 1);
        }

        this.camera.lookAt(target);
        this.controls.update();
    }

    setSliderValue(axis, value) {
        const slider = this.sliderElements[axis];
        const normalizedValue = this.normalizeSliderValue(axis, value);
        if (slider) {
            slider.value = String(normalizedValue);
        }

        const input = this.sliderInputElements[axis];
        if (input) {
            input.value = String(normalizedValue);
        }
    }

    normalizeSliderValue(axis, value) {
        const slider = this.sliderElements[axis];
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return Number(slider?.value || 0);
        }

        const min = Number(slider?.min ?? -180);
        const max = Number(slider?.max ?? 180);
        return Math.min(max, Math.max(min, Math.round(numericValue)));
    }

    getAxisForSliderTextInput(target) {
        if (!target) {
            return null;
        }

        if (target === this.sliderInputElements.x) {
            return 'x';
        }
        if (target === this.sliderInputElements.y) {
            return 'y';
        }
        if (target === this.sliderInputElements.z) {
            return 'z';
        }

        return null;
    }

    getAxisForSlider(target) {
        if (!target) {
            return null;
        }

        if (target === this.sliderElements.x) {
            return 'x';
        }
        if (target === this.sliderElements.y) {
            return 'y';
        }
        if (target === this.sliderElements.z) {
            return 'z';
        }

        return null;
    }

    setSourceMode(mode, options = {}) {
        let nextMode = 'raw';
        if (mode === 'calibrated') {
            nextMode = 'calibrated';
        }
        if (mode === 'calibratedCut') {
            nextMode = 'calibratedCut';
        }
        this.sourceMode = nextMode;

        if (this.sourceButtons.raw) {
            this.sourceButtons.raw.classList.toggle('active', nextMode === 'raw');
        }
        if (this.sourceButtons.calibrated) {
            this.sourceButtons.calibrated.classList.toggle('active', nextMode === 'calibrated');
        }
        if (this.sourceButtons.calibratedCut) {
            this.sourceButtons.calibratedCut.classList.toggle('active', nextMode === 'calibratedCut');
        }

        if (!options.silent) {
            this.log('source mode changed', { mode: nextMode });
        }

        this.applyCurrentSourceSample();
        this.applyCurrentGyroSample();
    }

    updateRotation(options = {}) {
        if (!this.rotationQuaternion) {
            return;
        }

        const THREE = this.THREE;
        const xDeg = Number(this.sliderElements.x?.value || 0);
        const yDeg = Number(this.sliderElements.y?.value || 0);
        const zDeg = Number(this.sliderElements.z?.value || 0);

        this.setSliderValue('x', xDeg);
        this.setSliderValue('y', yDeg);
        this.setSliderValue('z', zDeg);

        this.updateSliderLabel('x', xDeg);
        this.updateSliderLabel('y', yDeg);
        this.updateSliderLabel('z', zDeg);

        const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(xDeg),
            THREE.MathUtils.degToRad(yDeg),
            THREE.MathUtils.degToRad(zDeg),
            'XYZ'
        );

        this.rotationQuaternion.setFromEuler(euler).normalize();
        this.refreshQuaternionState({
            silent: options.silent,
            commit: options.commit,
        });
    }

    updateSliderLabel(axis, value) {
        const label = this.sliderValueElements[axis];
        if (label) {
            label.textContent = `${value.toFixed(0)}°`;
        }
    }

    setAccelerationSamples(samples = {}) {
        this.latestSamples.raw = samples.raw || this.latestSamples.raw;
        this.latestSamples.calibrated = samples.calibrated || this.latestSamples.calibrated;
        this.latestSamples.calibratedCut = samples.calibratedCut || this.latestSamples.calibratedCut;
        this.applyCurrentSourceSample();
    }

    setGyroSamples(samples = {}) {
        this.latestGyroSamples.raw = samples.raw || this.latestGyroSamples.raw;
        this.latestGyroSamples.calibrated = samples.calibrated || this.latestGyroSamples.calibrated;
        this.latestGyroSamples.calibratedCut = samples.calibratedCut || this.latestGyroSamples.calibratedCut;
        this.applyCurrentGyroSample();
    }

    applyCurrentSourceSample() {
        if (!this.THREE) {
            return;
        }

        let preferredSample = this.latestSamples.raw || this.latestSamples.calibrated || this.latestSamples.calibratedCut;
        if (this.sourceMode === 'calibrated') {
            preferredSample = this.latestSamples.calibrated || this.latestSamples.calibratedCut || this.latestSamples.raw;
        }
        if (this.sourceMode === 'calibratedCut') {
            preferredSample = this.latestSamples.calibratedCut || this.latestSamples.calibrated || this.latestSamples.raw;
        }

        if (!preferredSample) {
            return;
        }

        const x = Number(preferredSample?.x || 0);
        const y = Number(preferredSample?.y || 0);
        const z = Number(preferredSample?.z || 0);

        this.latestVector = new this.THREE.Vector3(x, y, z);
        if (!this.hasLoggedFirstSample) {
            this.hasLoggedFirstSample = true;
            this.log('first acceleration sample received', { x, y, z, mode: this.sourceMode });
        }
        this.updateVectors();
    }

    applyCurrentGyroSample() {
        if (!this.THREE) {
            return;
        }

        let preferredSample = this.latestGyroSamples.calibrated || this.latestGyroSamples.calibratedCut || this.latestGyroSamples.raw;
        if (this.sourceMode === 'calibratedCut') {
            preferredSample = this.latestGyroSamples.calibratedCut || this.latestGyroSamples.calibrated || this.latestGyroSamples.raw;
        }

        if (!preferredSample) {
            return;
        }

        const x = Number(preferredSample?.x || 0);
        const y = Number(preferredSample?.y || 0);
        const z = Number(preferredSample?.z || 0);
        this.latestGyroVector = new this.THREE.Vector3(x, y, z);
        this.updateGyroVectors();
    }

    updateVectors() {
        if (!this.latestVector || !this.rawVectorArrow || !this.rotatedVectorArrow) {
            return;
        }

        const rawVector = this.latestVector.clone();
        const resultQuaternion = this.getResultQuaternionObject();
        const resultVector = resultQuaternion
            ? rawVector.clone().applyQuaternion(resultQuaternion)
            : rawVector.clone();

        this.updateArrow(this.rawVectorArrow, rawVector);
        this.updateArrow(this.rotatedVectorArrow, resultVector);
        this.updateReadout(rawVector, resultVector);
        this.updateGyroVectors();
    }

    updateGyroVectors() {
        if (!this.latestGyroVector || !this.gyroRotatedRingSet) {
            return;
        }

        const worldVector = this.latestGyroVector.clone();
        this.updateGyroRingSet(this.gyroRotatedRingSet, worldVector, this.worldAxes, this.worldAxesGroup?.quaternion);

        this.updateVectorValues(this.gyroRotatedValueElements, worldVector);

        if (this.gyroMagnitudeElements.rotated) {
            this.gyroMagnitudeElements.rotated.textContent = worldVector.length().toFixed(1);
        }
    }

    updateGyroRingSet(ringSet, vector, anchorAxes, anchorQuaternion) {
        if (!ringSet?.axes) {
            return;
        }

        if (anchorQuaternion) {
            ringSet.group.quaternion.copy(anchorQuaternion);
        }

        this.positionGyroAxisRing(ringSet.axes.x, anchorAxes?.x, 'x');
        this.positionGyroAxisRing(ringSet.axes.y, anchorAxes?.y, 'y');
        this.positionGyroAxisRing(ringSet.axes.z, anchorAxes?.z, 'z');

        this.updateGyroAxisRing(ringSet.axes.x, vector.x);
        this.updateGyroAxisRing(ringSet.axes.y, vector.y);
        this.updateGyroAxisRing(ringSet.axes.z, vector.z);
    }

    positionGyroAxisRing(axisRing, anchorArrow, axisName) {
        if (!axisRing || !anchorArrow?.userData) {
            return;
        }

        const axisLength = (anchorArrow.userData.currentLength || 0) + 0.06;
        if (axisName === 'x') {
            axisRing.group.position.set(axisLength, 0, 0);
        } else if (axisName === 'y') {
            axisRing.group.position.set(0, axisLength, 0);
        } else {
            axisRing.group.position.set(0, 0, axisLength);
        }
    }

    updateGyroAxisRing(axisRing, value) {
        if (!axisRing) {
            return;
        }

        const rawValue = Number(value) || 0;
        const magnitude = Math.abs(rawValue);
        const normalized = Math.min(magnitude / this.gyroRingFullScaleMdps, 1);
        const arc = Math.max(0.16, normalized * Math.PI * 1.8);
        const opacity = 0.34 + normalized * 0.6;
        const thicknessScale = 1.15 + normalized * 1.05;
        const degreesPerSecond = rawValue / this.gyroMilliDegreesPerDegree;

        axisRing.angularVelocity = this.THREE.MathUtils.degToRad(degreesPerSecond);
        axisRing.currentArc = arc;

        axisRing.activeRing.geometry.dispose();
        axisRing.activeRing.geometry = new this.THREE.TorusGeometry(axisRing.radius, axisRing.tube * thicknessScale, 18, 72, arc);
        axisRing.activeRing.material.opacity = opacity;

        this.applyGyroAxisRingPhase(axisRing);
    }

    updateGyroAnimation(deltaSeconds) {
        if (!this.gyroRotatedRingSet?.axes || !deltaSeconds) {
            return;
        }

        Object.values(this.gyroRotatedRingSet.axes).forEach((axisRing) => {
            if (!axisRing) {
                return;
            }

            axisRing.phase += axisRing.angularVelocity * deltaSeconds;
            const fullTurn = Math.PI * 2;
            if (axisRing.phase > fullTurn || axisRing.phase < -fullTurn) {
                axisRing.phase %= fullTurn;
            }

            this.applyGyroAxisRingPhase(axisRing);
        });
    }

    applyGyroAxisRingPhase(axisRing) {
        axisRing.activeRing.rotation.set(0, 0, axisRing.phase);
    }

    updateArrow(arrow, vector, scaleFactor = this.vectorScale, maxLength = 3.6) {
        const magnitude = vector.length();
        const normalized = magnitude > 1e-6 ? vector.clone().normalize() : new this.THREE.Vector3(0, 0, 1);
        const scaledLength = Math.min(Math.max(magnitude * scaleFactor, 0.12), maxLength);
        this.setArrowVector(arrow, normalized, scaledLength);
    }

    setGyroVisible(visible, options = {}) {
        this.gyroVisible = Boolean(visible);

        if (this.sourceButtons.gyroToggle) {
            this.sourceButtons.gyroToggle.classList.toggle('active', this.gyroVisible);
            this.sourceButtons.gyroToggle.textContent = this.gyroVisible ? 'Gyro ausblenden' : 'Gyro anzeigen';
        }

        if (this.gyroCard) {
            this.gyroCard.classList.toggle('is-hidden', !this.gyroVisible);
        }

        if (this.gyroGroup) {
            this.gyroGroup.visible = this.gyroVisible;
        }

        if (!options.silent) {
            this.log('gyro visibility changed', { visible: this.gyroVisible });
        }
    }

    updateReadout(rawVector, rotatedVector) {
        this.updateVectorValues(this.rawValueElements, rawVector);
        this.updateVectorValues(this.rotatedValueElements, rotatedVector);

        if (this.magnitudeElements.raw) {
            this.magnitudeElements.raw.textContent = rawVector.length().toFixed(1);
        }
        if (this.magnitudeElements.rotated) {
            this.magnitudeElements.rotated.textContent = rotatedVector.length().toFixed(1);
        }
        if (this.statusElement) {
            let modeLabel = 'Rohwerte';
            if (this.sourceMode === 'calibrated') {
                modeLabel = 'Kalibriert';
            }
            if (this.sourceMode === 'calibratedCut') {
                modeLabel = 'Kalibriert - g';
            }
            this.statusElement.textContent = `${modeLabel} |a| ${rawVector.length().toFixed(1)} mg`; 
        }
    }

    updateQuaternionReadout(quaternion) {
        const appliedQuaternion = quaternion || this.getAppliedQuaternionObject();
        if (!appliedQuaternion) {
            return;
        }

        if (this.quaternionValueElements.x) {
            this.quaternionValueElements.x.textContent = appliedQuaternion.x.toFixed(4);
        }
        if (this.quaternionValueElements.y) {
            this.quaternionValueElements.y.textContent = appliedQuaternion.y.toFixed(4);
        }
        if (this.quaternionValueElements.z) {
            this.quaternionValueElements.z.textContent = appliedQuaternion.z.toFixed(4);
        }
        if (this.quaternionValueElements.w) {
            this.quaternionValueElements.w.textContent = appliedQuaternion.w.toFixed(4);
        }
    }

    getBaseQuaternionObject() {
        if (!this.baseQuaternion) {
            return null;
        }

        return this.baseQuaternion.clone().normalize();
    }

    getAdjustmentQuaternionObject() {
        if (!this.rotationQuaternion) {
            return null;
        }

        return this.rotationQuaternion.clone().normalize();
    }

    getAppliedQuaternionObject() {
        const baseQuaternion = this.getBaseQuaternionObject();
        const adjustmentQuaternion = this.getAdjustmentQuaternionObject();
        if (!baseQuaternion && !adjustmentQuaternion) {
            return null;
        }

        if (!baseQuaternion) {
            return adjustmentQuaternion;
        }

        if (!adjustmentQuaternion) {
            return baseQuaternion;
        }

        return adjustmentQuaternion.multiply(baseQuaternion).normalize();
    }

    getResultQuaternionObject() {
        if (this.sourceMode === 'raw') {
            return this.getAppliedQuaternionObject();
        }

        return null;
    }

    getFrameQuaternionObject() {
        const appliedQuaternion = this.getAppliedQuaternionObject();
        if (!appliedQuaternion) {
            return null;
        }

        return appliedQuaternion.clone().normalize();
    }

    getAppliedQuaternion() {
        const quaternion = this.getAppliedQuaternionObject();
        if (!quaternion) {
            return null;
        }

        return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
    }

    getAdjustmentQuaternion() {
        const quaternion = this.getAdjustmentQuaternionObject();
        if (!quaternion) {
            return null;
        }

        return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
    }

    refreshQuaternionState(options = {}) {
        const THREE = this.THREE;
        if (!THREE) {
            return;
        }

        this.rotatedFrameGroup.quaternion.copy(this.getFrameQuaternionObject() || new THREE.Quaternion());
        this.updateQuaternionReadout(this.getAppliedQuaternionObject());
        this.updateVectors();

        if (!options.silent && typeof this.options.onQuaternionChange === 'function') {
            this.options.onQuaternionChange({
                adjustmentQuaternion: this.getAdjustmentQuaternion(),
                appliedQuaternion: this.getAppliedQuaternion(),
                commit: Boolean(options.commit),
            });
        }
    }

    setBaseQuaternion(quaternion, options = {}) {
        if (!this.ensureInitialized()) {
            return false;
        }

        const normalizedQuaternion = this.normalizeQuaternion(quaternion) || new this.THREE.Quaternion();
        this.baseQuaternion.copy(normalizedQuaternion);
        this.refreshQuaternionState({
            silent: options.silent,
            commit: options.commit,
        });
        return true;
    }

    setAdjustmentQuaternion(quaternion, options = {}) {
        if (!this.ensureInitialized()) {
            return false;
        }

        const normalizedQuaternion = this.normalizeQuaternion(quaternion) || new this.THREE.Quaternion();
        this.rotationQuaternion.copy(normalizedQuaternion);

        const euler = new this.THREE.Euler().setFromQuaternion(this.rotationQuaternion, 'XYZ');
        this.setSliderValue('x', this.THREE.MathUtils.radToDeg(euler.x).toFixed(0));
        this.setSliderValue('y', this.THREE.MathUtils.radToDeg(euler.y).toFixed(0));
        this.setSliderValue('z', this.THREE.MathUtils.radToDeg(euler.z).toFixed(0));

        this.updateSliderLabel('x', Number(this.sliderElements.x?.value || 0));
        this.updateSliderLabel('y', Number(this.sliderElements.y?.value || 0));
        this.updateSliderLabel('z', Number(this.sliderElements.z?.value || 0));

        this.refreshQuaternionState({
            silent: options.silent,
            commit: options.commit,
        });

        return true;
    }

    setAppliedQuaternion(quaternion, options = {}) {
        if (!this.ensureInitialized()) {
            return false;
        }

        const normalizedQuaternion = this.normalizeQuaternion(quaternion);
        if (!normalizedQuaternion) {
            return false;
        }

        const baseQuaternion = this.getBaseQuaternionObject();
        const nextAdjustment = normalizedQuaternion.clone();
        if (baseQuaternion) {
            nextAdjustment.multiply(baseQuaternion.clone().invert()).normalize();
        }

        return this.setAdjustmentQuaternion(nextAdjustment, options);
    }

    normalizeQuaternion(quaternion) {
        if (!this.THREE || !quaternion) {
            return null;
        }

        const components = Array.isArray(quaternion)
            ? quaternion
            : (ArrayBuffer.isView(quaternion) || (typeof quaternion?.length === 'number' && quaternion.length >= 4))
                ? Array.from(quaternion).slice(0, 4)
            : [quaternion.x, quaternion.y, quaternion.z, quaternion.w];

        if (components.length < 4 || components.some((value) => !Number.isFinite(Number(value)))) {
            return null;
        }

        const normalized = new this.THREE.Quaternion(
            Number(components[0]),
            Number(components[1]),
            Number(components[2]),
            Number(components[3])
        );

        if (normalized.lengthSq() < 1e-12) {
            return null;
        }

        return normalized.normalize();
    }

    updateVectorValues(targets, vector) {
        if (targets.x) {
            targets.x.textContent = vector.x.toFixed(1);
        }
        if (targets.y) {
            targets.y.textContent = vector.y.toFixed(1);
        }
        if (targets.z) {
            targets.z.textContent = vector.z.toFixed(1);
        }
    }

    setVisible(visible) {
        this.log('setVisible called', { visible, initialized: this.initialized });
        if (visible && !this.ensureInitialized()) {
            this.warn('setVisible aborted because initialization failed');
            return;
        }

        if (this.visible === visible) {
            if (visible) {
                this.scheduleResize();
            }
            return;
        }

        this.visible = visible;

        if (this.visible) {
            this.scheduleResize();
            this.start();
        } else {
            this.stop();
        }
    }

    start() {
        if (this.rafId) {
            this.log('start skipped because raf already active');
            return;
        }

        this.log('start rendering loop');

        const renderFrame = (timestamp) => {
            if (!this.visible) {
                this.log('render loop stopped because tab is hidden');
                this.rafId = null;
                this.lastRenderTime = 0;
                return;
            }

            const deltaSeconds = this.lastRenderTime ? Math.min((timestamp - this.lastRenderTime) / 1000, 0.05) : 0;
            this.lastRenderTime = timestamp;

            this.updateGyroAnimation(deltaSeconds);
            this.controls?.update();
            this.renderer.render(this.scene, this.camera);
            if (!this.hasLoggedFirstFrame) {
                this.hasLoggedFirstFrame = true;
                this.log('first frame rendered', {
                    canvasWidth: this.renderer.domElement.width,
                    canvasHeight: this.renderer.domElement.height,
                });
            }
            this.rafId = globalThis.requestAnimationFrame(renderFrame);
        };

        renderFrame();
    }

    stop() {
        if (this.rafId) {
            this.log('stop rendering loop');
            globalThis.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.resizeFrameId) {
            globalThis.cancelAnimationFrame(this.resizeFrameId);
            this.resizeFrameId = null;
        }
        this.lastRenderTime = 0;
    }

    resize() {
        if (!this.viewport || !this.renderer || !this.camera) {
            return;
        }

        const viewportRect = this.viewport.getBoundingClientRect();
        const width = Math.round(viewportRect.width || this.viewport.clientWidth || 0);
        const height = Math.round(viewportRect.height || this.viewport.clientHeight || 0);

        this.log('resize attempt', {
            width,
            height,
            visible: this.visible,
            display: globalThis.getComputedStyle(this.viewport).display,
        });

        if (!width || !height) {
            this.warn('resize aborted because viewport has zero size');
            return;
        }

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.renderer.render(this.scene, this.camera);
        this.log('resize applied', {
            canvasWidth: this.renderer.domElement.width,
            canvasHeight: this.renderer.domElement.height,
        });
    }

    scheduleResize() {
        this.log('scheduleResize');
        if (this.resizeFrameId) {
            globalThis.cancelAnimationFrame(this.resizeFrameId);
            this.resizeFrameId = null;
        }

        this.resize();

        let remainingFrames = 3;
        const runDeferredResize = () => {
            this.resizeFrameId = null;
            this.resize();
            remainingFrames -= 1;

            if (remainingFrames > 0) {
                this.resizeFrameId = globalThis.requestAnimationFrame(runDeferredResize);
            }
        };

        this.resizeFrameId = globalThis.requestAnimationFrame(runDeferredResize);
    }

    setStatus(text) {
        if (this.statusElement) {
            this.statusElement.textContent = text;
        }
    }
}