export class RingBuffer {
    constructor(size, ArrayType = Float32Array) {
        this.size = size;
        this.buffer = new ArrayType(size);
        this.index = 0;
        this.length = 0;
    }
    push(value) {
        this.buffer[this.index] = value;
        this.index = (this.index + 1) % this.size;
        if (this.length < this.size) this.length++;
    }
    toArray() {
        if (this.length < this.size) return Array.from(this.buffer.slice(0, this.length));
        const out = new this.buffer.constructor(this.length);
        out.set(this.buffer.subarray(this.index));
        out.set(this.buffer.subarray(0, this.index), this.size - this.index);
        return Array.from(out);
    }
}

export class MultiRingBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.index = 0;
        this.size = 0;
    }

    push(sample) {
        this.buffer[this.index] = sample; // sample = { time, x, y, z }
        this.index = (this.index + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }

    pushMany(samples) {
        for (const s of samples) this.push(s);
    }

    getLast(n) {
        const count = Math.min(n, this.size);
        const result = new Array(count);
        for (let i = 0; i < count; i++) {
            const idx = (this.index - count + i + this.capacity) % this.capacity;
            result[i] = this.buffer[idx];
        }
        return result;
    }

    // optional: columns extrahieren
    getFields(fieldName, n) {
        return this.getLast(n).map(s => s[fieldName]);
    }
}

export class MultiRingBuffer2 {
    constructor(channelTypes, size, channelNames) {
        this.channels = channelTypes.map(C => new C(size));
        this.index = 0;
        this.length = 0;
        this.size = size;
        this._lastSlices = Array(channelTypes.length).fill(null);
        this._lastSlicesCount = Array(channelTypes.length).fill(null);
        this._lastSlicesIndex = Array(channelTypes.length).fill(null);

        this.channelMap = channelNames.reduce((map, name, idx) => {
            map[name] = idx;
            return map;
        }, {});
        this.channelNames = channelNames;  // unbedingt setzen!
    }

    push(values) {
        if (!Array.isArray(values) || values.length !== this.channels.length) {
            throw new Error(`push(): values muss Array mit ${this.channels.length} Elementen sein.`);
        }
        for (let ch = 0; ch < values.length; ch++) {
            this.channels[ch][this.index] = values[ch];
            this._lastSlices[ch] = null;
        }
        this.index = (this.index + 1) % this.size;
        if (this.length < this.size) this.length++;
    }

    getLast() {
        if (!this.length) return null;
        const idx = (this.index + this.size - 1) % this.size;
        return this.channelNames.reduce((o, n, i) => { o[n] = this.channels[i][idx]; return o; }, {});
    }

    getChannelTypedArray(channel) {
        const buf = this.channels[channel];
        if (this.length < this.size) {
            return buf.subarray(0, this.length);
        } else {
            if (this._lastSlices[channel]) return this._lastSlices[channel];
            let arr = new buf.constructor(this.size);
            arr.set(buf.subarray(this.index));
            arr.set(buf.subarray(0, this.index), this.size - this.index);
            this._lastSlices[channel] = arr;
            return arr;
        }
    }

    getLast() {
        if (this.length === 0) return null; // kein Wert vorhanden
        const lastIdx = (this.index + this.size - 1) % this.size;
        const result = {};
        for (let i = 0; i < this.channels.length; i++) {
            result[this.channelNames[i]] = this.channels[i][lastIdx];
        }
        return result;
    }

    getFieldTypedArray(fieldName, N) {
        const ch = this.channelMap[fieldName];
        if (ch === undefined) throw new Error(`Unknown field name: ${fieldName}`);
        const buf = this.channels[ch];
        const len = this.length;
        const count = Math.min(N, len);

        if (len < this.size) {
            return buf.subarray(len - count, len);
        } else {
            if (this._lastSlices[ch] &&
                this._lastSlicesCount[ch] === count &&
                this._lastSlicesIndex[ch] === this.index) {
                return this._lastSlices[ch];
            }
            const arr = new buf.constructor(count);
            let startIdx = (this.index + this.size - count) % this.size;

            if (startIdx + count <= this.size) {
                arr.set(buf.subarray(startIdx, startIdx + count));
            } else {
                const firstPartLen = this.size - startIdx;
                arr.set(buf.subarray(startIdx, this.size));
                arr.set(buf.subarray(0, count - firstPartLen), firstPartLen);
            }

            this._lastSlices[ch] = arr;
            this._lastSlicesCount[ch] = count;
            this._lastSlicesIndex[ch] = this.index;

            return arr;
        }
    }

    getFieldValueAt(fieldName, logicalIndex) {
        const ch = this.channelMap[fieldName];
        if (ch === undefined) throw new Error(`Unknown field name: ${fieldName}`);
        if (logicalIndex < 0 || logicalIndex >= this.length) {
            throw new RangeError(`logicalIndex out of range: ${logicalIndex}`);
        }

        const physicalIndex = this._logicalToPhysicalIndex(logicalIndex);
        return this.channels[ch][physicalIndex];
    }

    findFirstIndexAtOrAfter(fieldName, minValue) {
        let low = 0;
        let high = this.length;

        while (low < high) {
            const mid = low + ((high - low) >> 1);
            if (this.getFieldValueAt(fieldName, mid) < minValue) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        return low;
    }

    getWindowFromIndex(startLogicalIndex, fieldNames) {
        const start = Math.max(0, Math.min(startLogicalIndex, this.length));
        const count = this.length - start;
        const result = {};

        for (const fieldName of fieldNames) {
            const ch = this.channelMap[fieldName];
            if (ch === undefined) throw new Error(`Unknown field name: ${fieldName}`);

            const buf = this.channels[ch];
            const out = new buf.constructor(count);
            if (count > 0) {
                this._copyLogicalRangeToArray(ch, start, count, out);
            }
            result[fieldName] = out;
        }

        return result;
    }

    getWindowByTime(timeFieldName, minTime, fieldNames) {
        if (this.length === 0) {
            return this.getWindowFromIndex(0, fieldNames);
        }

        const startIndex = this.findFirstIndexAtOrAfter(timeFieldName, minTime);
        return this.getWindowFromIndex(startIndex, fieldNames);
    }

    _logicalToPhysicalIndex(logicalIndex) {
        if (this.length < this.size) {
            return logicalIndex;
        }
        return (this.index + logicalIndex) % this.size;
    }

    _copyLogicalRangeToArray(channelIndex, startLogicalIndex, count, targetArray) {
        const source = this.channels[channelIndex];
        const physicalStart = this._logicalToPhysicalIndex(startLogicalIndex);

        if (physicalStart + count <= this.size) {
            targetArray.set(source.subarray(physicalStart, physicalStart + count));
            return;
        }

        const firstPartLength = this.size - physicalStart;
        targetArray.set(source.subarray(physicalStart, this.size));
        targetArray.set(source.subarray(0, count - firstPartLength), firstPartLength);
    }

    /**
     * Buffer leeren.
     * @param {boolean} fullReset - wenn true, werden auch alle Werte im Speicher auf 0 gesetzt.
     */
    clear(fullReset = false) {
        this.index = 0;
        this.length = 0;
        this._lastSlices.fill(null);
        this._lastSlicesCount.fill(null);
        this._lastSlicesIndex.fill(null);

        if (fullReset) {
            for (let buf of this.channels) {
                buf.fill(0);
            }
        }
    }

getSpreadPercent(fieldName) {
    const arr = this.getChannelTypedArray(this.channelMap[fieldName]);
    if (!arr || arr.length === 0) return 0;

    // Mittelwert
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;

    if (mean === 0) return 0; // Division durch 0 vermeiden

    // Standardabweichung
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    const stddev = Math.sqrt(variance);

    // Streuung in %
    return (stddev / Math.abs(mean)) * 100;
}

getAbsoluteDelta(fieldName) {
    const arr = this.getChannelTypedArray(this.channelMap[fieldName]);
    if (!arr || arr.length === 0) return 0;

    let min = arr[0];
    let max = arr[0];

    for (let i = 1; i < arr.length; i++) {
        if (arr[i] < min) min = arr[i];
        if (arr[i] > max) max = arr[i];
    }

    return max - min; // absoluter Unterschied
}

getMean(fieldName) {
    const ch = this.channelMap[fieldName];
    if (ch === undefined) throw new Error(`Unknown field name: ${fieldName}`);
    
    const arr = this.getChannelTypedArray(ch);
    if (!arr || arr.length === 0) return 0;

    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
    }

    return sum / arr.length;
}

}


















export class UniDropdown {
    static instances = [];
    static hasDocListener = false;

    /**
     * @param {HTMLElement} container
     * @param {Object} options
     * @param {'select'|'slider'|'logslider'} options.type
     */
    constructor(container, options = {}) {
        this.type = options.type || "select";
        this.container = container;
        this.button = container.querySelector('.dropdown-button');
        this.labelSpan = this.button.querySelector('.label');
        this.dropdownContent = container.querySelector('.dropdown-content');
        this.options = options;
        this.displayMultiplier = options.displayMultiplier || 1;

        UniDropdown.instances.push(this);

        // Typ-spezifisch initialisieren
        if (this.type === "select") {
            this.initSelect(options);
        } else if (this.type === "slider") {
            this.initSlider(options);
        } else if (this.type === "logslider") {
            this.initLogSlider(options);
        }

        // Button Click -> Öffnen/Schließen
        this.button.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (this.container.classList.contains('open')) {
                this.close();
            } else {
                UniDropdown.closeAll(this); // schließt alle anderen
                this.open();
            }
        });

        // Globaler Klick-Listener nur einmal registrieren
        if (!UniDropdown.hasDocListener) {
            document.addEventListener('click', e => {
                const isInsideDropdown = e.target.closest('.dropdown');
                if (!isInsideDropdown) {
                    UniDropdown.closeAll();
                }
            });
            UniDropdown.hasDocListener = true;
        }
    }

    // ---------- SELECT ----------
    initSelect(options) {
        this.mainLabel = options.label || 'Menü';
        this.items = options.items || [];
        this.activeOption = null;

        this.dropdownContent.innerHTML = '';
        this.items.forEach(item => {
            const a = document.createElement('a');
            a.href = "#";
            a.dataset.value = item.value;
            a.textContent = item.label;
            this.dropdownContent.appendChild(a);
        });

        this.optionsElements = [...this.dropdownContent.querySelectorAll('a')];

        if (options.defaultValue !== undefined) {
            const defaultStr = String(options.defaultValue);
            const opt = this.optionsElements.find(o => o.dataset.value === defaultStr);
            this.setActiveOption(opt || this.optionsElements[0]);
        } else if (options.defaultIndex !== undefined && this.optionsElements[options.defaultIndex]) {
            this.setActiveOption(this.optionsElements[options.defaultIndex]);
        } else {
            this.setActiveOption(this.optionsElements[0]);
        }

        this.optionsElements.forEach(option => {
            option.addEventListener('click', e => {
                e.preventDefault();
                this.setActiveOption(option);
                this.close();
                if (typeof options.onChange === "function") {
                    options.onChange(option.dataset.value, option.textContent);
                }
            });
        });
    }

    setActiveOption(optionElement) {
        if (!optionElement) return;
        if (this.activeOption) this.activeOption.classList.remove('active');
        this.activeOption = optionElement;
        this.activeOption.classList.add('active');
        this.labelSpan.textContent = `${this.mainLabel}: ${optionElement.textContent}`;
    }

    // ---------- SLIDER ----------
    initSlider(options) {
        this.mainLabel = options.label || 'Wert';
        this.min = options.min ?? 0;
        this.max = options.max ?? 100;
        this.step = options.step ?? 1;
        this.value = options.defaultValue ?? this.min;
        this.onChange = options.onChange;

        this.dropdownContent.innerHTML = '';
        this.slider = document.createElement('input');
        this.slider.type = 'range';
        this.slider.className = 'dropdown-slider';
        this.slider.min = this.min;
        this.slider.max = this.max;
        this.slider.step = this.step;
        this.slider.value = this.value;
        this.dropdownContent.appendChild(this.slider);

        this.updateSliderLabel();

        this.slider.addEventListener('input', () => {
            this.value = this.slider.value;
            this.updateSliderLabel();
            if (typeof this.onChange === 'function') {
                this.onChange(Number(this.value));
            }
        });
    }

        updateSliderLabel() {
            const displayValue = Number(this.value) * this.displayMultiplier;
            this.labelSpan.textContent = `${this.mainLabel}: ${displayValue}`;
        }

    // ---------- LOGSLIDER ----------
    initLogSlider(options) {
        this.mainLabel = options.label || 'Wert';
        this.minValue = options.minValue ?? 0.001;
        this.maxValue = options.maxValue ?? 100;
        this.step = options.step ?? 1;
        this.value = options.defaultValue ?? this.minValue;
        this.alpha = options.alpha ?? 0.5;

        this.dropdownContent.innerHTML = '';
        this.slider = document.createElement('input');
        this.slider.type = 'range';
        this.slider.className = 'dropdown-slider';
        this.slider.min = 0;
        this.slider.max = 100;
        this.slider.step = this.step;
        this.slider.value = this.valueToPosition(this.value);
        this.dropdownContent.appendChild(this.slider);

        this.updateLogSliderLabel();

        this.slider.addEventListener('input', () => {
            const val = this.positionToValue(Number(this.slider.value));
            this.value = val;
            this.updateLogSliderLabel();
            if (typeof this.options.onChange === 'function') {
                this.options.onChange(val);
            }
        });
    }

    positionToValue(pos) {
        if (pos <= 0) return 0;
        let normPos = pos / 100;
        normPos = Math.pow(normPos, this.alpha);
        const logMin = Math.log10(this.minValue);
        const logMax = Math.log10(this.maxValue);
        const logValue = logMin + normPos * (logMax - logMin);
        return Number(Math.pow(10, logValue).toFixed(6));
    }

    valueToPosition(value) {
        if (value <= 0) return 0;
        if (value < this.minValue) return 1;
        const logMin = Math.log10(this.minValue);
        const logMax = Math.log10(this.maxValue);
        const logValue = Math.log10(value);
        let normPos = (logValue - logMin) / (logMax - logMin);
        normPos = Math.pow(normPos, 1 / this.alpha);
        normPos = Math.min(Math.max(normPos, 0), 1);
        return Math.round(normPos * 100);
    }

        updateLogSliderLabel() {
            const displayValue = Number(this.value) * this.displayMultiplier;
            this.labelSpan.textContent = `${this.mainLabel}: ${displayValue.toFixed(3)}`;
        }

    // ---------- Öffnen/Schließen ----------
    open() {
        this.container.classList.add('open');
    }
    close() {
        this.container.classList.remove('open');
    }
    static closeAll(except = null) {
        UniDropdown.instances.forEach(dd => {
            if (dd !== except) dd.close();
        });
    }

    getValue() {
        if (this.type === "select") {
            return {
                value: this.activeOption?.dataset.value,
                label: this.activeOption?.textContent
            };
        } else {
            return Number(this.value);
        }
    }

    // ---------- Neue Setter mit silent-Flag ----------
    setValueSelect(value, silent = false) {
        const opt = this.optionsElements.find(o => o.dataset.value == value);
        if (!opt) return;
        if (this.activeOption === opt) return;
        this.setActiveOption(opt);
        if (!silent && typeof this.options.onChange === "function") {
            this.options.onChange(opt.dataset.value, opt.textContent);
        }
    }

    setValueSlider(value, silent = false) {
        this.value = value;
        this.slider.value = value;
        this.updateSliderLabel();
        if (!silent && typeof this.onChange === 'function') {
            this.onChange(Number(this.value));
        }
    }

    setValueLogSlider(value, silent = false) {
        this.value = value;
        this.slider.value = this.valueToPosition(value);
        this.updateLogSliderLabel();
        if (!silent && typeof this.options.onChange === 'function') {
            this.options.onChange(this.value);
        }
    }

    // Einheitlicher Setter
    setValue(value, silent = false) {
        if (this.type === "select") {
            this.setValueSelect(value, silent);
        } else if (this.type === "slider") {
            this.setValueSlider(value, silent);
        } else if (this.type === "logslider") {
            this.setValueLogSlider(value, silent);
        }
    }

    setMaxValue(newMax) {
        if (this.type === "slider" || this.type === "logslider") {
            this.max = newMax;
            if (this.slider) {
                this.slider.max = newMax;
                // Falls aktueller Wert über neuem Maximum liegt, auf Maximum setzen
                if (Number(this.value) > newMax) {
                    this.setValue(newMax, true); // Silent = true, um kein onChange auszulösen
                }
                // Optional Label auch updaten
                if (this.type === "slider") {
                    this.updateSliderLabel();
                } else if (this.type === "logslider") {
                    this.updateLogSliderLabel();
                }
            }
        }
    }

    setDisplayMultiplier(multiplier) {
        this.displayMultiplier = multiplier;
        if (this.type === "slider") {
            this.updateSliderLabel();
        } else if (this.type === "logslider") {
            this.updateLogSliderLabel();
        }
    } 
    
    /**
 * Fügt einen Eintrag an gewünschter Stelle hinzu
 * @param {{label: string, value: string}} item – Das neue Element
 * @param {number} [index] – Optional: Einfügeposition, sonst ans Ende
 */
addSelectItem(item, index) {
    if (this.type !== "select") return;
    // In das Datenarray einfügen
    if (typeof index === "number" && index >= 0 && index <= this.items.length) {
        this.items.splice(index, 0, item);
    } else {
        this.items.push(item);
        index = this.items.length - 1;
    }
    // Im DOM ein Element erstellen
    const a = document.createElement('a');
    a.href = "#";
    a.dataset.value = item.value;
    a.textContent = item.label;
    // Klicklistener hinzufügen
    a.addEventListener('click', e => {
        e.preventDefault();
        this.setActiveOption(a);
        this.close();
        if (typeof this.options.onChange === "function") {
            this.options.onChange(a.dataset.value, a.textContent);
        }
    });
    // Im Dropdown einfügen (an Index-Stelle)
    if (typeof index === "number" && index < this.dropdownContent.children.length) {
        this.dropdownContent.insertBefore(a, this.dropdownContent.children[index]);
    } else {
        this.dropdownContent.appendChild(a);
    }
    // Die gecachten Links neu ziehen, falls gebraucht
    this.optionsElements = [...this.dropdownContent.querySelectorAll('a')];
}

/**
 * Entfernt Eintrag an bestimmtem Index
 * @param {number} index – Index des zu entfernenden Elements
 */
removeSelectItem(index) {
    if (this.type !== "select") return;
    if (index < 0 || index >= this.items.length) return;
    // Datenarray aktualisieren
    this.items.splice(index, 1);
    // Element im DOM entfernen
    const el = this.dropdownContent.children[index];
    if (el) el.remove();
    // Die gecachten Links neu ziehen
    this.optionsElements = [...this.dropdownContent.querySelectorAll('a')];
    // Falls das entfernte Element aktiv war, neues auswählen
    if (this.activeOption === el) {
        if (this.optionsElements[0]) {
            this.setActiveOption(this.optionsElements);
        } else {
            this.activeOption = null;
            this.labelSpan.textContent = this.mainLabel;
        }
    }
}


}
