function getElementSizeById(id) {
    const container = document.getElementById(id);
    const rect = container.getBoundingClientRect();
    return {
        width: Math.max(0, Math.round(rect.width || container.clientWidth)),
        height: Math.max(0, Math.round(rect.height || container.clientHeight)),
    };
}

export function getSize() {
    return getElementSizeById('accChartHost');
}

export function getGyroChartSize() {
    return getElementSizeById('gyroChartHost');
}

export function getFftChartSize() {
    return getElementSizeById('fftChart');
}

export function getRmsChartSize() {
    return getElementSizeById('rmsChart');
}

export function getGyroFftChartSize() {
    return getElementSizeById('gyroFftChart');
}

export function getGyroRmsChartSize() {
    return getElementSizeById('gyroRmsChart');
}

export function getViewportMetrics() {
    const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const viewportWidth = Math.round(window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0);
    return { viewportHeight, viewportWidth };
}

function updateTwoPanelGridHeights({ gridId, panelIds, controlsSelector }) {
    const grid = document.getElementById(gridId);
    const panels = panelIds.map((id) => document.getElementById(id));
    const controls = document.querySelector(controlsSelector);
    if (!grid || panels.some((panel) => !panel) || !controls) {
        return;
    }

    const { viewportHeight, viewportWidth } = getViewportMetrics();
    document.documentElement.style.setProperty('--viewport-height', `${viewportHeight}px`);
    document.documentElement.style.setProperty('--viewport-width', `${viewportWidth}px`);

    const gridRect = grid.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).gap || '12') || 12;
    const bottomPadding = 16;
    const visiblePanels = panels.filter((panel) => getComputedStyle(panel).display !== 'none');

    grid.classList.toggle('single-visible', visiblePanels.length === 1);
    panels.forEach((panel) => {
        panel.style.height = '';
    });

    if (visiblePanels.length === 0) {
        return;
    }

    const topAnchor = Math.max(gridRect.top, controlsRect.bottom + 10);
    const availableHeight = Math.max(220, Math.floor(viewportHeight - topAnchor - bottomPadding));
    const hasSideBySideLayout = grid.classList.contains('is-side-by-side');
    const isSingleVisible = visiblePanels.length === 1;

    let panelHeight;
    if (hasSideBySideLayout && isSingleVisible) {
        panelHeight = Math.max(420, availableHeight);
    } else if (hasSideBySideLayout) {
        const desiredSideBySideHeight = Math.floor(viewportHeight * 0.70);
        panelHeight = Math.max(380, Math.min(availableHeight, desiredSideBySideHeight));
    } else if (isSingleVisible) {
        panelHeight = Math.max(360, availableHeight);
    } else {
        const availablePerPanel = Math.floor((availableHeight - gap * (visiblePanels.length - 1)) / visiblePanels.length);
        panelHeight = Math.max(220, availablePerPanel);
    }

    visiblePanels.forEach((panel) => {
        panel.style.height = `${panelHeight}px`;
    });
}

export function updateLiveChartPanelHeights() {
    updateTwoPanelGridHeights({
        gridId: 'livechartsGrid',
        panelIds: ['livechart2', 'gyrochart'],
        controlsSelector: '#liveChartForm .chart-controls',
    });
}

export function updateFftRmsPanelHeights() {
    updateTwoPanelGridHeights({
        gridId: 'fftRmsGrid',
        panelIds: ['fftPanel', 'rmsPanel'],
        controlsSelector: '#fftRmsChartControls',
    });
}

export function updateGyroFftRmsPanelHeights() {
    updateTwoPanelGridHeights({
        gridId: 'gyroFftRmsGrid',
        panelIds: ['gyroFftPanel', 'gyroRmsPanel'],
        controlsSelector: '#gyroFftRmsChartControls',
    });
}