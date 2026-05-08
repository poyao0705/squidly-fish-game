/**
 * @fileoverview Game UI Manager
 *
 * Manages all DOM-related UI elements for the Fish Game:
 * - HUD
 * - Sidebar buttons
 * - Star control grid
 */

export class GameUI {
  constructor(config = {}) {
    this.config = {
      layoutStarsRequiredDefault: 3,
      ...config,
    };

    this._hudElement = null;
    this._layoutStarsElement = null;
    this._layoutProgressTextElement = null;
    this._starGridElement = null;
    this._starCells = [];
    this._swapButtonKey = null;
    this._setStarsButtonKey = null;
    this._increaseGridButtonKey = null;
    this._onGridIncrease = null;
    this._onHome = null;
    this._canIncreaseGrid = false;
    this._isLayoutComplete = false;
    this._layoutStarsEarned = 0;
    this._layoutStarsRequired = this.config.layoutStarsRequiredDefault;
  }

  /**
   * Initialize static UI elements.
   */
  init() {
    this._createTopHud();
  }

  /**
   * Sets up sidebar icon for gated Grid progression.
   * @param {Object} callbacks - { onGridIncrease, onHome, canIncreaseGrid }
   */
  setupGridControls({ onGridIncrease, onHome, canIncreaseGrid = false }) {
    this._onGridIncrease = onGridIncrease;
    this._onHome = onHome;
    this._canIncreaseGrid = canIncreaseGrid;
    this._updateGridIncreaseControl();
  }

  /**
   * Updates the layout-completion HUD and grid progression gate.
   * @param {number} earnedStars - Layout stars earned toward unlocking next grid
   * @param {number} requiredStars - Layout stars required to complete this grid
   * @param {?boolean} canIncreaseGrid - Whether the next grid can be selected
   */
  updateLayoutProgress(
    earnedStars,
    requiredStars = this.config.layoutStarsRequiredDefault,
    canIncreaseGrid = null,
  ) {
    const parsedRequired = Number(requiredStars);
    const safeRequired =
      Number.isFinite(parsedRequired) && parsedRequired > 0
        ? Math.round(parsedRequired)
        : this.config.layoutStarsRequiredDefault;

    const parsedEarned = Number(earnedStars);
    this._layoutStarsRequired = safeRequired;
    this._layoutStarsEarned =
      Number.isFinite(parsedEarned) && parsedEarned >= 0
        ? Math.min(safeRequired, Math.round(parsedEarned))
        : 0;

    this._isLayoutComplete =
      this._layoutStarsEarned >= this._layoutStarsRequired;
    this._canIncreaseGrid =
      typeof canIncreaseGrid === "boolean"
        ? canIncreaseGrid
        : this._isLayoutComplete;
    this._renderLayoutProgress();
    this._updateGridIncreaseControl();
  }

  /**
   * Updates the visibility of the swap button.
   * @param {boolean} isMultiplayerMode
   * @param {Function} onSwapClick
   */
  updateSwapButton(isMultiplayerMode, onSwapClick) {
    this._clearSidebarIcon("_swapButtonKey");

    if (isMultiplayerMode) {
      this._swapButtonKey = SquidlyAPI.setIcon(
        3,
        0,
        {
          symbol: "switch",
          displayValue: "Swap Roles",
          type: "action",
        },
        onSwapClick,
      );
    }
  }

  updateSetStarsButton(shouldShow, onSetStarsClick) {
    this._clearSidebarIcon("_setStarsButtonKey");

    if (!shouldShow) return;

    this._setStarsButtonKey = SquidlyAPI.setIcon(
      2,
      0,
      {
        symbol: "edit",
        displayValue: "Set Stars",
        type: "action",
      },
      onSetStarsClick,
    );
  }

  /**
   * Creates or destroys the star control grid based on mode/host status.
   * @param {boolean} shouldShow - Whether the grid should be visible
   * @param {number} gridSize - Size of grid
   * @param {Array} stars - Current stars array
   * @param {Function} onCellClick - Callback(row, col)
   */
  updateStarControlGrid(shouldShow, gridSize, stars, onCellClick) {
    if (!shouldShow) {
      this._destroyStarControlGrid();
      return;
    }

    this._destroyStarControlGrid();

    const grid = document.createElement("div");
    grid.className = "star-control-grid";
    grid.id = "star-control-grid";
    grid.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;

    this._starCells = [];

    let cellIndex = 0;
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cell = document.createElement("access-button");
        cell.className = "star-control-cell";
        cell.dataset.row = row;
        cell.dataset.col = col;

        cell.setAttribute("access-group", "star-grid");
        cell.setAttribute("access-order", cellIndex);

        const starIcon = document.createElement("span");
        starIcon.className = "star-icon";
        starIcon.textContent = "\u2B50";
        cell.appendChild(starIcon);

        cell.addEventListener("access-click", () => {
          onCellClick(row, col);
        });

        grid.appendChild(cell);
        this._starCells.push({ row, col, element: cell });
        cellIndex++;
      }
    }

    document.body.appendChild(grid);
    this._starGridElement = grid;

    this.updateStarCellStates(stars);
  }

  /**
   * Updates visual state of star cells.
   * @param {Array} stars
   */
  updateStarCellStates(stars) {
    if (!this._starGridElement || !this._starCells.length) return;

    this._starCells.forEach(({ row, col, element }) => {
      const hasStar = stars.some((s) => s.row === row && s.col === col);
      if (hasStar) {
        element.classList.add("has-star");
      } else {
        element.classList.remove("has-star");
      }
    });
  }

  _destroyStarControlGrid() {
    if (this._starGridElement) {
      this._starGridElement.remove();
      this._starGridElement = null;
    }
    this._starCells = [];
  }

  _updateGridIncreaseControl() {
    this._clearSidebarIcon("_increaseGridButtonKey");

    const isCompletedWithoutNextGrid =
      this._isLayoutComplete && !this._canIncreaseGrid;
    const displayValue = this._canIncreaseGrid
      ? "Next Level"
      : isCompletedWithoutNextGrid
        ? "Home"
        : "Next Level";
    const disabled = !this._canIncreaseGrid && !isCompletedWithoutNextGrid;

    this._increaseGridButtonKey = SquidlyAPI.setIcon(
      1,
      0,
      {
        symbol: this._canIncreaseGrid
          ? "add"
          : isCompletedWithoutNextGrid
            ? "home"
            : "lock",
        displayValue,
        type: "action",
        disabled,
      },
      () => {
        if (this._canIncreaseGrid) {
          if (this._onGridIncrease) this._onGridIncrease();
          return;
        }

        if (isCompletedWithoutNextGrid && this._onHome) {
          this._onHome();
        }
      },
    );
  }

  _clearSidebarIcon(keyProperty) {
    if (!this[keyProperty]) return;
    SquidlyAPI.removeIcon(this[keyProperty]);
    this[keyProperty] = null;
  }

  _renderLayoutProgress() {
    if (!this._layoutStarsElement || !this._layoutProgressTextElement) return;

    this._layoutStarsElement.innerHTML = "";

    for (let i = 0; i < this._layoutStarsRequired; i++) {
      const star = document.createElement("span");
      star.className =
        i < this._layoutStarsEarned
          ? "hud-layout-star earned"
          : "hud-layout-star";
      star.textContent = "\u2B50";
      this._layoutStarsElement.appendChild(star);
    }

    this._layoutProgressTextElement.textContent = this._isLayoutComplete
      ? this._canIncreaseGrid
        ? "Next grid unlocked"
        : "Ready for home"
      : `${this._layoutStarsEarned}/${this._layoutStarsRequired} clears`;
  }

  _createTopHud() {
    if (this._hudElement) return;

    const container = document.createElement("div");
    container.id = "top-hud";

    const progressSection = document.createElement("div");
    progressSection.className = "hud-section layout-progress-section";

    const progressLabel = document.createElement("span");
    progressLabel.className = "hud-label";
    progressLabel.textContent = "Grid Progress";

    this._layoutStarsElement = document.createElement("div");
    this._layoutStarsElement.className = "hud-layout-stars";

    this._layoutProgressTextElement = document.createElement("span");
    this._layoutProgressTextElement.className = "hud-progress-text";

    progressSection.appendChild(progressLabel);
    progressSection.appendChild(this._layoutStarsElement);
    progressSection.appendChild(this._layoutProgressTextElement);

    container.appendChild(progressSection);
    document.body.appendChild(container);

    this._hudElement = container;
    this._renderLayoutProgress();
  }
}
