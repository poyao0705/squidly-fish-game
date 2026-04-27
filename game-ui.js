/**
 * @fileoverview Game UI Manager
 *
 * Manages all DOM-related UI elements for the Fish Game:
 * - Score display
 * - Sidebar icons
 * - Star control grid
 */

export class GameUI {
  constructor() {
    this._scoreElement = null;
    this._hudElement = null;
    this._layoutStarsElement = null;
    this._layoutProgressTextElement = null;
    this._starGridElement = null;
    this._starCells = [];
    this._swapButtonKey = null;
    this._increaseGridButtonKey = null;
    this._onGridIncrease = null;
    this._canIncreaseGrid = false;
    this._isLayoutComplete = false;
    this._layoutStarsEarned = 0;
    this._layoutStarsRequired = 3;
  }

  /**
   * Initialize static UI elements like score.
   * @param {number} initialScore
   */
  init(initialScore = 0) {
    this._createTopHud(initialScore);
  }

  /**
   * Updates the displayed score.
   * @param {number} score
   */
  updateScore(score) {
    if (this._scoreElement) {
      this._scoreElement.textContent = score;
    }
  }

  /**
   * Sets up sidebar icon for gated Grid progression.
   * @param {Object} callbacks - { onGridIncrease, canIncreaseGrid }
   */
  setupGridControls({ onGridIncrease, canIncreaseGrid = false }) {
    this._onGridIncrease = onGridIncrease;
    this._canIncreaseGrid = canIncreaseGrid;
    this._updateGridIncreaseControl();
  }

  /**
   * Updates the layout-completion HUD and grid progression gate.
   * @param {number} earnedStars - Layout stars earned toward unlocking next grid
   * @param {number} requiredStars - Layout stars required to complete this grid
   * @param {?boolean} canIncreaseGrid - Whether the next grid can be selected
   */
  updateLayoutProgress(earnedStars, requiredStars = 3, canIncreaseGrid = null) {
    const parsedRequired = Number(requiredStars);
    const safeRequired =
      Number.isFinite(parsedRequired) && parsedRequired > 0
        ? Math.round(parsedRequired)
        : 3;

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
    // Remove existing
    if (this._swapButtonKey) {
      SquidlyAPI.removeIcon(this._swapButtonKey);
      this._swapButtonKey = null;
    }

    if (isMultiplayerMode) {
      this._swapButtonKey = SquidlyAPI.setIcon(
        3,
        0,
        {
          symbol: "switch",
          displayValue: "Swap Host/Participant Roles",
          type: "action",
        },
        onSwapClick,
      );
    }
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

    // If grid needs to be created or recreated (size change check could be added for opt,
    // but destroying/creating is safer for simplicity unless perf is issue)
    // Here we can check if we already have a grid and if it matches size.
    // For now, let's keep it robust: destroy and recreate if it doesn't match or to ensure cleanness.
    // Optimisation: check if grid exists and size matches.

    // Simple approach: Always recreate if showing to ensure correct state,
    // or checks. Let's replicate original logic:
    // Original logic called destroy then create.
    this._destroyStarControlGrid();

    // Create grid container
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

    // Apply initial states
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
    if (this._increaseGridButtonKey) {
      SquidlyAPI.removeIcon(this._increaseGridButtonKey);
      this._increaseGridButtonKey = null;
    }

    const isCompletedWithoutNextGrid =
      this._isLayoutComplete && !this._canIncreaseGrid;

    this._increaseGridButtonKey = SquidlyAPI.setIcon(
      1,
      0,
      {
        symbol: this._canIncreaseGrid
          ? "add"
          : isCompletedWithoutNextGrid
            ? "tick"
            : "tools-unlocked",
        displayValue: this._canIncreaseGrid
          ? "Increase Grid"
          : isCompletedWithoutNextGrid
            ? "Grid Complete"
            : `Clear all stars ${this._layoutStarsRequired} times to unlock`,
        type: "action",
      },
      () => {
        if (!this._canIncreaseGrid || !this._onGridIncrease) return;
        this._onGridIncrease();
      },
    );
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
        : "Grid complete"
      : `${this._layoutStarsEarned}/${this._layoutStarsRequired} clears`;
  }

  _createTopHud(initialScore) {
    if (this._hudElement) return;

    const container = document.createElement("div");
    container.id = "top-hud";

    const scoreSection = document.createElement("div");
    scoreSection.className = "hud-section score-section";

    const scoreLabel = document.createElement("span");
    scoreLabel.className = "hud-label";
    scoreLabel.textContent = "Score";

    const scoreIcon = document.createElement("span");
    scoreIcon.className = "score-icon";
    scoreIcon.textContent = "\u2B50";

    this._scoreElement = document.createElement("span");
    this._scoreElement.className = "score-value";
    this._scoreElement.textContent = initialScore;

    const progressSection = document.createElement("div");
    progressSection.className = "hud-section layout-progress-section";

    const progressLabel = document.createElement("span");
    progressLabel.className = "hud-label";
    progressLabel.textContent = "Grid Progress";

    this._layoutStarsElement = document.createElement("div");
    this._layoutStarsElement.className = "hud-layout-stars";

    this._layoutProgressTextElement = document.createElement("span");
    this._layoutProgressTextElement.className = "hud-progress-text";

    scoreSection.appendChild(scoreLabel);
    scoreSection.appendChild(scoreIcon);
    scoreSection.appendChild(this._scoreElement);

    progressSection.appendChild(progressLabel);
    progressSection.appendChild(this._layoutStarsElement);
    progressSection.appendChild(this._layoutProgressTextElement);

    container.appendChild(scoreSection);
    container.appendChild(progressSection);
    document.body.appendChild(container);

    this._hudElement = container;
    this._renderLayoutProgress();
  }
}
