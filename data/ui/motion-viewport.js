export class MotionViewport {
    constructor(options = {}) {
        this.options = options;
        this.debugPrefix = '[MOTION-3D]';
        this.root = document.getElementById(options.rootId || 'motionViewportTab');
        this.viewport = document.getElementById(options.viewportId || 'motionViewport');
        this.viewcube = document.getElementById(options.viewcubeId || 'motionViewcube');
        this.statusElement = document.getElementById(options.statusId || 'motionViewportStatus');
        this.arrowOpacityElements = this.getArrowOpacityElements(options);
        this.axisColorElements = this.getAxisColorElements(options);
        this.vectorColorElements = this.getVectorColorElements(options);
        this.backgroundPresetElement = document.getElementById(options.backgroundPresetId || 'motionBackgroundPreset');

        this.THREE = globalThis.THREE;
        this.visible = false;
        this.initialized = false;
        this.initError = null;
        this.resizeObserver = null;
        this.resizeFrameId = null;
        this.rafId = null;
        this.lastRenderTime = 0;
        this.displayScale = 3;
        this.currentMode = 'motion';
        this.latestState = null;
        this.vibrationTipTrail = [];
        this.arrowOpacity = { world: 0.42, trail: 0.9, velocity: 0.86, acceleration: 0.82 };
        this.arrowOpacityBindings = { world: [], trail: [], velocity: [], acceleration: [] };
        this.axisColors = { x: '#ff0000', y: '#00ff00', z: '#0000ff' };
        this.vectorColors = { trail: '#00e5ff', velocity: '#ffa000', acceleration: '#ffd400' };
        this.backgroundPreset = 'steel';

        this.boundHandleResize = this.handleResize.bind(this);
        this.boundHandleViewcubeClick = this.handleViewcubeClick.bind(this);
        this.boundHandleArrowOpacityInput = this.handleArrowOpacityInput.bind(this);
        this.boundHandleArrowOpacityCommit = this.handleArrowOpacityCommit.bind(this);
        this.boundHandleAxisColorInput = this.handleAxisColorInput.bind(this);
        this.boundHandleVectorColorInput = this.handleVectorColorInput.bind(this);
        this.boundHandleBackgroundPresetChange = this.handleBackgroundPresetChange.bind(this);
    }

    log(message, details) {
        if (details !== undefined) {
            console.log(`${this.debugPrefix} ${message}`, details);
            return;
        }

        console.log(`${this.debugPrefix} ${message}`);
    }

    ensureElements() {
        this.root = document.getElementById(this.options.rootId || 'motionViewportTab');
        this.viewport = document.getElementById(this.options.viewportId || 'motionViewport');
        this.viewcube = document.getElementById(this.options.viewcubeId || 'motionViewcube');
        this.statusElement = document.getElementById(this.options.statusId || 'motionViewportStatus');
        this.arrowOpacityElements = this.getArrowOpacityElements(this.options);
        this.axisColorElements = this.getAxisColorElements(this.options);
        this.vectorColorElements = this.getVectorColorElements(this.options);
        this.backgroundPresetElement = document.getElementById(this.options.backgroundPresetId || 'motionBackgroundPreset');
        return Boolean(this.root && this.viewport && this.THREE);
    }

    getArrowOpacityElements(options = {}) {
        return {
            world: {
                slider: document.getElementById(options.arrowOpacityWorldSliderId || 'motionArrowOpacityWorld'),
                input: document.getElementById(options.arrowOpacityWorldInputId || 'motionArrowOpacityWorldInput'),
                value: document.getElementById(options.arrowOpacityWorldValueId || 'motionArrowOpacityWorldValue'),
            },
            trail: {
                slider: document.getElementById(options.arrowOpacityTrailSliderId || 'motionArrowOpacityTrail'),
                input: document.getElementById(options.arrowOpacityTrailInputId || 'motionArrowOpacityTrailInput'),
                value: document.getElementById(options.arrowOpacityTrailValueId || 'motionArrowOpacityTrailValue'),
            },
            velocity: {
                slider: document.getElementById(options.arrowOpacityVelocitySliderId || 'motionArrowOpacityVelocity'),
                input: document.getElementById(options.arrowOpacityVelocityInputId || 'motionArrowOpacityVelocityInput'),
                value: document.getElementById(options.arrowOpacityVelocityValueId || 'motionArrowOpacityVelocityValue'),
            },
            acceleration: {
                slider: document.getElementById(options.arrowOpacityAccelerationSliderId || 'motionArrowOpacityAcceleration'),
                input: document.getElementById(options.arrowOpacityAccelerationInputId || 'motionArrowOpacityAccelerationInput'),
                value: document.getElementById(options.arrowOpacityAccelerationValueId || 'motionArrowOpacityAccelerationValue'),
            },
        };
    }

    getAxisColorElements(options = {}) {
        return {
            x: document.getElementById(options.axisColorXInputId || 'motionAxisColorX'),
            y: document.getElementById(options.axisColorYInputId || 'motionAxisColorY'),
            z: document.getElementById(options.axisColorZInputId || 'motionAxisColorZ'),
        };
    }

    getVectorColorElements(options = {}) {
        return {
            trail: document.getElementById(options.vectorColorTrailInputId || 'motionVectorColorTrail'),
            velocity: document.getElementById(options.vectorColorVelocityInputId || 'motionVectorColorVelocity'),
            acceleration: document.getElementById(options.vectorColorAccelerationInputId || 'motionVectorColorAcceleration'),
        };
    }

    getAxisColorSwatches(axisName) {
        return Array.from(this.root?.querySelectorAll(`[data-motion-axis-color-swatch="${axisName}"]`) || []);
    }

    getVectorColorSwatches(groupName) {
        return Array.from(this.root?.querySelectorAll(`[data-motion-vector-color-swatch="${groupName}"]`) || []);
    }

    ensureInitialized() {
        if (this.initialized) {
            return true;
        }

        this.THREE = globalThis.THREE;
        if (!this.ensureElements()) {
            return false;
        }

        try {
            this.setupScene();
            this.bindEvents();
            this.initialized = true;
            this.initError = null;
            if (this.latestState) {
                this.setState(this.latestState);
            }
            this.resize();
            return true;
        } catch (error) {
            this.initError = error;
            console.error('Motion viewport init failed:', error);
            this.setStatus('Motion-Viewport konnte nicht initialisiert werden');
            return false;
        }
    }

    setupScene() {
        const THREE = this.THREE;
        const OrbitControlsCtor = THREE.OrbitControls || globalThis.OrbitControls;
        if (!OrbitControlsCtor) {
            throw new Error('OrbitControls not available');
        }

        this.scene = new THREE.Scene();
        this.scene.background = null;

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
        this.camera.up.set(0, 0, 1);
        this.camera.position.set(4.8, -4.4, 4.6);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
        this.renderer.setClearAlpha(0);
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }

        this.viewport.appendChild(this.renderer.domElement);

        this.controls = new OrbitControlsCtor(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 1.4;
        this.controls.maxDistance = 40;
        this.controls.target.set(0, 0, 0);

        this.applyBackgroundPreset(this.backgroundPreset, { silent: true });

        const ambientLight = new THREE.HemisphereLight(0xe8fbff, 0x081217, 0.9);
        this.scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 0.92);
        keyLight.position.set(4, 6, 5);
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x6fb6ff, 0.5);
        fillLight.position.set(-4, -2, 3);
        this.scene.add(fillLight);

        this.worldAxesGroup = new THREE.Group();
        this.scene.add(this.worldAxesGroup);
        this.worldAxesGroup.add(this.createCircularGrid());

        this.worldAxes = {
            x: this.createAxisArrow(new THREE.Vector3(1, 0, 0), 0xff0000, 2.4),
            y: this.createAxisArrow(new THREE.Vector3(0, 1, 0), 0x00ff00, 2.4),
            z: this.createAxisArrow(new THREE.Vector3(0, 0, 1), 0x0000ff, 2.4),
        };
        this.worldAxesGroup.add(this.worldAxes.x, this.worldAxes.y, this.worldAxes.z);
        this.worldAxisLabels = {
            x: this.createAxisLabel('Xw', 0xff0000, new THREE.Vector3(0.12, 2.7, 0), 0.28),
            y: this.createAxisLabel('Yw', 0x00ff00, new THREE.Vector3(0.12, 2.7, 0), 0.28),
            z: this.createAxisLabel('Zw', 0x0000ff, new THREE.Vector3(0.12, 2.7, 0), 0.28),
        };
        this.worldAxes.x.add(this.worldAxisLabels.x);
        this.worldAxes.y.add(this.worldAxisLabels.y);
        this.worldAxes.z.add(this.worldAxisLabels.z);

        this.trailGroup = new THREE.Group();
        this.scene.add(this.trailGroup);

        this.trailMaterial = new THREE.LineBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.95,
        });
        this.trailGeometry = new THREE.BufferGeometry();
        this.trailLine = new THREE.Line(this.trailGeometry, this.trailMaterial);
        this.trailGroup.add(this.trailLine);

        this.originMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 20, 20),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
        );
        this.scene.add(this.originMarker);

        this.currentPoint = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 24, 24),
            new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x0c5e6c, roughness: 0.35, metalness: 0.18 })
        );
        this.scene.add(this.currentPoint);

        this.velocityArrow = this.createVectorArrow(0xffa000, 0.045, 0.13);
        this.accelerationArrow = this.createVectorArrow(0xffd400, 0.04, 0.12);
        this.scene.add(this.velocityArrow, this.accelerationArrow);

        Object.keys(this.arrowOpacity).forEach((groupName) => {
            this.applyArrowOpacity(groupName);
        });
        Object.keys(this.axisColors).forEach((axisName) => {
            this.applyAxisColor(axisName);
            this.syncAxisColorControls(axisName);
        });
        Object.keys(this.vectorColors).forEach((groupName) => {
            this.applyVectorColor(groupName);
            this.syncVectorColorControls(groupName);
        });

        this.resize();
    }

    bindEvents() {
        globalThis.addEventListener('resize', this.boundHandleResize);
        if (this.viewcube) {
            this.viewcube.addEventListener('click', this.boundHandleViewcubeClick);
        }

        Object.values(this.arrowOpacityElements).forEach((groupElements) => {
            if (groupElements?.slider) {
                groupElements.slider.addEventListener('input', this.boundHandleArrowOpacityInput);
                groupElements.slider.addEventListener('change', this.boundHandleArrowOpacityCommit);
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

        if ('ResizeObserver' in globalThis && this.viewport) {
            this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
            this.resizeObserver.observe(this.viewport);
        }
    }

    createCircularGrid() {
        const THREE = this.THREE;
        const group = new THREE.Group();
        const majorVertices = [];
        const minorVertices = [];
        const radius = 4.5;
        const rings = 9;
        const divisions = 24;

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
            target.push(0, 0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        };

        for (let ringIndex = 1; ringIndex <= rings; ringIndex++) {
            pushCircle(ringIndex === rings ? majorVertices : minorVertices, (radius / rings) * ringIndex);
        }

        for (let divisionIndex = 0; divisionIndex < divisions; divisionIndex++) {
            const angle = (divisionIndex / divisions) * Math.PI * 2;
            pushRadial(divisionIndex % 6 === 0 ? majorVertices : minorVertices, angle);
        }

        const createSegments = (vertices, color, opacity) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
            const line = new THREE.LineSegments(
                geometry,
                material
            );
            this.arrowOpacityBindings.world.push(material);
            return line;
        };

        group.add(createSegments(minorVertices, 0x265469, 0.18));
        group.add(createSegments(majorVertices, 0x74bed8, 0.38));
        return group;
    }

    createAxisArrow(direction, color, length) {
        const group = this.createVectorArrow(color, 0.024, 0.1, {
            length,
            negativeLength: length,
        });
        this.setArrowVector(group, direction, length);
        return group;
    }

    createAxisLabel(text, color, position, scale = 0.34) {
        const THREE = this.THREE;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 128;

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.scale.set(scale * 2, scale, 1);
        sprite.userData = {
            text,
            baseScale: scale,
            canvas,
            context,
            texture,
            material,
        };
        this.updateAxisLabelAppearance(sprite, color);
        return sprite;
    }

    updateAxisLabelAppearance(label, colorValue) {
        const canvas = label?.userData?.canvas;
        const context = label?.userData?.context;
        const texture = label?.userData?.texture;
        if (!canvas || !context || !texture) {
            return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = 'bold 60px Segoe UI';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = colorValue;
        context.fillText(label.userData.text || '', canvas.width / 2, canvas.height / 2 + 4);
        texture.needsUpdate = true;
    }

    createVectorArrow(color, shaftRadius, headLength, options = {}) {
        const THREE = this.THREE;
        const length = options.length ?? 1;
        const negativeLength = Math.max(0, options.negativeLength ?? 0);
        const headRadius = options.headRadius ?? (headLength * 0.45);
        const shaftLength = Math.max(0.001, length - headLength);
        const opacityGroup = options.opacityGroup || 'trail';
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
        const group = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 16), material);
        const tail = negativeLength > 0
            ? new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 16), material)
            : null;
        const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 20), material);

        shaft.scale.y = shaftLength;
        shaft.position.y = shaftLength / 2;
        if (tail) {
            tail.scale.y = negativeLength;
            tail.position.y = -negativeLength / 2;
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
            negativeLength,
            currentLength: length,
            opacityGroup,
        };

        if (!Array.isArray(this.arrowOpacityBindings[opacityGroup])) {
            this.arrowOpacityBindings[opacityGroup] = [];
        }
        this.arrowOpacityBindings[opacityGroup].push(material);

        return group;
    }

    setArrowVector(arrow, vector, fallbackLength = 0.001) {
        const THREE = this.THREE;
        const data = arrow?.userData;
        if (!data) {
            return;
        }

        const rawLength = vector.length();
        const length = Math.max(fallbackLength, rawLength);
        const direction = rawLength > 1e-6
            ? vector.clone().normalize()
            : new THREE.Vector3(0, 0, 1);
        const shaftLength = Math.max(0.001, length - data.headLength);

        data.shaft.scale.y = shaftLength;
        data.shaft.position.y = shaftLength / 2;
        if (data.tail) {
            data.tail.scale.y = data.negativeLength;
            data.tail.position.y = -data.negativeLength / 2;
        }
        data.head.position.y = shaftLength + data.headLength / 2;
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    }

    updateTrail(points = []) {
        const THREE = this.THREE;
        if (!this.trailGeometry || !this.currentPoint) {
            return;
        }

        if (!points.length) {
            this.trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
            this.trailGeometry.computeBoundingSphere();
            this.currentPoint.visible = false;
            return;
        }

        const scaled = [];
        for (let index = 0; index < points.length; index++) {
            const point = points[index];
            scaled.push(
                Number(point.x || 0) * this.displayScale,
                Number(point.y || 0) * this.displayScale,
                Number(point.z || 0) * this.displayScale,
            );
        }

        this.trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(scaled, 3));
        this.trailGeometry.computeBoundingSphere();

        const lastPoint = points[points.length - 1];
        this.currentPoint.visible = true;
        this.currentPoint.position.set(
            Number(lastPoint.x || 0) * this.displayScale,
            Number(lastPoint.y || 0) * this.displayScale,
            Number(lastPoint.z || 0) * this.displayScale,
        );
    }

    updateVibrationTipTrail(state = {}) {
        const sampleTimeUs = Number(state.sampleTimeUs || 0);
        const timeUs = Number.isFinite(sampleTimeUs) && sampleTimeUs > 0
            ? sampleTimeUs
            : Math.round(performance.now() * 1000);
        const tipPoint = {
            x: Number(state.linearAcc?.x || 0) * 0.12,
            y: Number(state.linearAcc?.y || 0) * 0.12,
            z: Number(state.linearAcc?.z || 0) * 0.12,
        };

        this.vibrationTipTrail.push({ timeUs, ...tipPoint });
        const trailSeconds = Math.max(1, Number(state.trailSeconds || 5));
        const maxAgeUs = trailSeconds * 1_000_000;
        const minTimeUs = timeUs - maxAgeUs;
        while (this.vibrationTipTrail.length > 0 && this.vibrationTipTrail[0].timeUs < minTimeUs) {
            this.vibrationTipTrail.shift();
        }

        this.updateTrail(this.vibrationTipTrail);
    }

    updateVectors(state = {}) {
        if (!this.velocityArrow || !this.accelerationArrow) {
            return;
        }

        const anchor = this.currentMode === 'vibration'
            ? new this.THREE.Vector3()
            : (this.currentPoint?.visible ? this.currentPoint.position.clone() : new this.THREE.Vector3());
        const velocity = new this.THREE.Vector3(
            Number(state.velocity?.x || 0),
            Number(state.velocity?.y || 0),
            Number(state.velocity?.z || 0),
        ).multiplyScalar(this.displayScale * 0.7);
        const acceleration = new this.THREE.Vector3(
            Number(state.linearAcc?.x || 0),
            Number(state.linearAcc?.y || 0),
            Number(state.linearAcc?.z || 0),
        ).multiplyScalar(this.displayScale * 0.12);

        this.velocityArrow.position.copy(anchor);
        this.accelerationArrow.position.copy(anchor);
        this.setArrowVector(this.velocityArrow, velocity, 0.001);
        this.setArrowVector(this.accelerationArrow, acceleration, 0.001);
    }

    setState(state = {}) {
        this.latestState = state;
        if (typeof state.mode === 'string') {
            if (this.currentMode !== state.mode && state.mode !== 'vibration') {
                this.vibrationTipTrail = [];
            }
            this.currentMode = state.mode;
        }

        if (!this.initialized) {
            if (this.visible) {
                this.ensureInitialized();
            }
            if (!this.initialized) {
                return;
            }
        }

        if (this.currentMode === 'vibration') {
            this.updateVibrationTipTrail(state);
        } else {
            this.vibrationTipTrail = [];
            this.updateTrail(Array.isArray(state.trail) ? state.trail : []);
        }
        this.updateVectors(state);
    }

    handleArrowOpacityInput(event) {
        const opacityGroup = event?.target?.dataset?.opacityGroup;
        if (!opacityGroup) {
            return;
        }
        const numericValue = Number(event?.target?.value);
        const nextPercent = Number.isFinite(numericValue) ? numericValue : Math.round((this.arrowOpacity[opacityGroup] ?? 0.5) * 100);
        this.setArrowOpacity(opacityGroup, nextPercent / 100, { silent: true });
    }

    handleArrowOpacityCommit(event) {
        const opacityGroup = event?.target?.dataset?.opacityGroup;
        if (!opacityGroup) {
            return;
        }
        const numericValue = Number(event?.target?.value);
        const nextPercent = Number.isFinite(numericValue) ? numericValue : Math.round((this.arrowOpacity[opacityGroup] ?? 0.5) * 100);
        this.setArrowOpacity(opacityGroup, nextPercent / 100);
    }

    handleAxisColorInput(event) {
        const axisName = event?.target?.dataset?.axisColor;
        if (!axisName) {
            return;
        }
        this.setAxisColor(axisName, event?.target?.value);
    }

    handleVectorColorInput(event) {
        const groupName = event?.target?.dataset?.vectorColor;
        if (!groupName) {
            return;
        }
        this.setVectorColor(groupName, event?.target?.value);
    }

    handleBackgroundPresetChange(event) {
        this.setBackgroundPreset(event?.target?.value);
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
            this.emitDisplaySettingsChange();
        }
    }

    normalizeArrowOpacity(groupName, value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return this.arrowOpacity[groupName] ?? 0.5;
        }
        return Math.min(1, Math.max(0.08, numericValue));
    }

    applyArrowOpacity(groupName) {
        const materials = this.arrowOpacityBindings[groupName];
        if (!Array.isArray(materials)) {
            return;
        }
        const opacity = this.arrowOpacity[groupName] ?? 0.5;
        materials.forEach((material) => {
            if (material) {
                material.opacity = opacity;
            }
        });

        if (groupName === 'world') {
            Object.keys(this.worldAxisLabels || {}).forEach((axisName) => {
                this.syncAxisLabelOpacity(axisName);
            });
        }
    }

    setAxisColor(axisName, colorValue, options = {}) {
        if (!axisName || !(axisName in this.axisColors)) {
            return;
        }

        const normalizedColor = this.normalizeColor(colorValue, this.axisColors[axisName]);
        this.axisColors[axisName] = normalizedColor;
        this.applyAxisColor(axisName);
        this.syncAxisColorControls(axisName);
        if (!options.silent) {
            this.emitDisplaySettingsChange();
        }
    }

    applyAxisColor(axisName) {
        const colorValue = this.axisColors[axisName] ?? '#ffffff';
        const axisMaterial = this.worldAxes?.[axisName]?.userData?.material;
        if (axisMaterial?.color) {
            axisMaterial.color.set(colorValue);
        }
        const axisLabel = this.worldAxisLabels?.[axisName];
        if (axisLabel) {
            this.updateAxisLabelAppearance(axisLabel, colorValue);
        }
    }

    syncAxisLabelOpacity(axisName) {
        const axisMaterial = this.worldAxes?.[axisName]?.userData?.material;
        const axisLabelMaterial = this.worldAxisLabels?.[axisName]?.material || this.worldAxisLabels?.[axisName]?.userData?.material;
        if (!axisLabelMaterial) {
            return;
        }

        axisLabelMaterial.opacity = axisMaterial?.opacity ?? 1;
        axisLabelMaterial.needsUpdate = true;
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

        const normalizedColor = this.normalizeColor(colorValue, this.vectorColors[groupName]);
        this.vectorColors[groupName] = normalizedColor;
        this.applyVectorColor(groupName);
        this.syncVectorColorControls(groupName);
        if (!options.silent) {
            this.emitDisplaySettingsChange();
        }
    }

    applyVectorColor(groupName) {
        const colorValue = this.vectorColors[groupName] ?? '#ffffff';
        if (groupName === 'trail') {
            this.trailMaterial?.color?.set(colorValue);
            this.currentPoint?.material?.color?.set(colorValue);
            return;
        }

        const arrow = groupName === 'velocity' ? this.velocityArrow : this.accelerationArrow;
        arrow?.userData?.material?.color?.set(colorValue);
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

    normalizeColor(colorValue, fallback) {
        if (typeof colorValue !== 'string') {
            return fallback;
        }
        const trimmedColor = colorValue.trim().toLowerCase();
        if (/^#[0-9a-f]{6}$/i.test(trimmedColor)) {
            return trimmedColor;
        }
        return fallback;
    }

    getBackgroundPresets() {
        return {
            steel: 'linear-gradient(180deg, rgba(29, 39, 49, 0.98), rgba(11, 17, 24, 0.98))',
            'steel-soft': 'linear-gradient(180deg, rgba(57, 71, 84, 0.98), rgba(27, 37, 46, 0.98))',
            'steel-light': 'linear-gradient(180deg, rgba(114, 129, 143, 0.98), rgba(70, 83, 95, 0.96) 48%, rgba(39, 48, 56, 0.98))',
            aurora: 'radial-gradient(circle at 18% 16%, rgba(68, 188, 224, 0.36), rgba(7, 20, 29, 0) 36%), radial-gradient(circle at 82% 18%, rgba(21, 97, 197, 0.22), rgba(7, 20, 29, 0) 28%), linear-gradient(180deg, rgba(10, 24, 31, 0.98), rgba(5, 14, 18, 0.98))',
            dusk: 'linear-gradient(135deg, rgba(33, 58, 88, 0.96), rgba(73, 39, 92, 0.94) 48%, rgba(19, 20, 38, 0.98))',
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

    setDisplayScale(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return;
        }

        this.displayScale = numericValue;
        if (this.latestState) {
            this.setState(this.latestState);
        }
    }

    setStatus(text) {
        if (this.statusElement) {
            this.statusElement.textContent = text;
        }
    }

    setVisible(visible) {
        const nextVisible = Boolean(visible);
        if (this.visible === nextVisible) {
            return;
        }

        this.visible = nextVisible;
        if (nextVisible) {
            if (!this.ensureInitialized()) {
                return;
            }
            this.scheduleResize();
            this.startRenderLoop();
            return;
        }

        this.stopRenderLoop();
    }

    scheduleResize() {
        if (this.resizeFrameId) {
            cancelAnimationFrame(this.resizeFrameId);
        }

        this.resizeFrameId = requestAnimationFrame(() => {
            this.resizeFrameId = null;
            this.resize();
        });
    }

    resize() {
        if (!this.viewport || !this.renderer || !this.camera) {
            return;
        }

        const width = Math.max(1, this.viewport.clientWidth || 1);
        const height = Math.max(1, this.viewport.clientHeight || 1);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    handleResize() {
        if (this.visible) {
            this.scheduleResize();
        }
    }

    handleViewcubeClick(event) {
        const button = event.target?.closest?.('[data-view]');
        if (!button) {
            return;
        }

        this.snapToView(button.dataset.view);
    }

    snapToView(direction) {
        if (!this.camera || !this.controls) {
            return;
        }

        const target = this.controls.target.clone();
        const distance = Math.max(this.camera.position.distanceTo(target), 5.6);
        const vectors = {
            front: new this.THREE.Vector3(0, -1, 0),
            back: new this.THREE.Vector3(0, 1, 0),
            right: new this.THREE.Vector3(1, 0, 0),
            left: new this.THREE.Vector3(-1, 0, 0),
            top: new this.THREE.Vector3(0, 0, 1),
            bottom: new this.THREE.Vector3(0, 0, -1),
        };

        const nextDirection = vectors[direction];
        if (!nextDirection) {
            return;
        }

        this.camera.position.copy(target).add(nextDirection.multiplyScalar(distance));
        this.camera.up.set(0, 0, 1);
        if (direction === 'top') {
            this.camera.up.set(0, 1, 0);
        } else if (direction === 'bottom') {
            this.camera.up.set(0, -1, 0);
        }
        this.camera.lookAt(target);
        this.controls.update();
    }

    startRenderLoop() {
        if (this.rafId) {
            return;
        }

        const renderFrame = (time) => {
            this.rafId = requestAnimationFrame(renderFrame);
            const deltaSeconds = this.lastRenderTime ? Math.min((time - this.lastRenderTime) / 1000, 0.1) : 0.016;
            this.lastRenderTime = time;
            this.render(deltaSeconds);
        };

        this.rafId = requestAnimationFrame(renderFrame);
    }

    stopRenderLoop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.lastRenderTime = 0;
    }

    render() {
        if (!this.renderer || !this.scene || !this.camera) {
            return;
        }

        this.controls?.update();
        this.renderer.render(this.scene, this.camera);
    }
}