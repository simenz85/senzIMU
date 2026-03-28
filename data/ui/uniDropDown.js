export default class UniDropdown {
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
    this.labelSpan.textContent = `${this.mainLabel}: ${this.value}`;
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
    this.labelSpan.textContent = `${this.mainLabel}: ${Number(this.value).toFixed(3)}`;
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
}
