/**
 * @fileoverview Game Service - Pure Game Logic Layer
 *
 * This module contains all game business logic without any dependencies on
 * Firebase, DOM, or external APIs. It provides pure functions and state management
 * for the fish game.
 *
 * ## Design Principles
 * - No Firebase calls
 * - No DOM manipulation
 * - No global state access
 * - Pure functions where possible
 * - Testable in isolation
 *
 * @module GameService
 */

/**
 * GameService - Pure game logic service layer
 *
 * Manages game state and provides methods for game operations:
 * - Star generation and management
 * - Score calculation
 * - Game mode rules
 * - Grid size validation
 *
 * @class
 */
export const GAME_MODES = Object.freeze({
  SINGLE_PLAYER: "single-player",
  MULTIPLAYER: "multiplayer",
});

export const GAME_RULES = Object.freeze({
  GRID_MIN_SIZE: 1,
  GRID_MAX_SIZE: 4,
  REQUIRED_LAYOUT_CLEARS: 3,
  STAR_REGEN_DELAY_MS: 500,
  STARTUP_RETRY_DELAY_MS: 100,
  RANDOM_GRID_OFFSET_RANGE: 0.7,
});

export function createGameRules(overrides = {}) {
  return Object.freeze({ ...GAME_RULES, ...overrides });
}

class GameService {
  /**
   * Creates a new GameService instance
   *
   * @constructor
   * @param {Object} [initialState={}] - Initial game state
   * @param {number} [initialState.score=0] - Starting score
   * @param {number} [initialState.gridSize=1] - Grid dimension (1-4)
   * @param {boolean} [initialState.isMultiplayerMode=false] - Game mode
   * @param {Array} [initialState.stars=[]] - Initial stars array
   */
  constructor(initialState = {}, rules = GAME_RULES) {
    this.rules = createGameRules(rules);

    /**
     * Current game score
     * @type {number}
     */
    this.score = initialState.score ?? 0;

    /**
     * Grid dimension (1-4)
     * @type {number}
     */
    this.gridSize = this.validateGridSize(
      initialState.gridSize ?? this.rules.GRID_MIN_SIZE,
    );

    /**
     * Whether multiplayer mode is active
     * @type {boolean}
     */
    this.isMultiplayerMode = initialState.isMultiplayerMode ?? false;

    /**
     * Current stars array
     * @type {Array<{id: string, row: number, col: number, offsetX?: number, offsetY?: number}>}
     */
    this.stars = initialState.stars ?? [];
  }

  /**
   * Validates and clamps grid size to valid range (1-4)
   *
   * @param {number} size - Grid size to validate
   * @returns {number} Validated grid size (1-4)
   */
  validateGridSize(size) {
    const n = Number(size);
    if (!Number.isFinite(n)) return this.rules.GRID_MIN_SIZE;
    return Math.max(
      this.rules.GRID_MIN_SIZE,
      Math.min(this.rules.GRID_MAX_SIZE, Math.round(n)),
    );
  }

  /**
   * Calculates how many stars should be generated for a given grid size
   * Uses 50% of total cells as the star count
   *
   * @param {number} gridSize - Grid dimension
   * @returns {number} Number of stars to generate
   */
  calculateStarCount(gridSize) {
    const validSize = this.validateGridSize(gridSize);
    const totalCells = validSize * validSize;
    return Math.max(1, Math.ceil(totalCells / 2));
  }

  /**
   * Creates a star ID from grid position
   * Uses deterministic format to match IDs parsed from Firebase string format
   *
   * @param {number} row - Grid row
   * @param {number} col - Grid column
   * @returns {string} Star ID in format "star_row_col"
   */
  createStarId(row, col) {
    return `star_${row}_${col}`;
  }

  parseStarId(starId) {
    const match = /^star_(\d+)_(\d+)$/.exec(String(starId));
    if (!match) return null;

    return {
      row: Number(match[1]),
      col: Number(match[2]),
    };
  }

  createStarCellKey(row, col) {
    return `${row}_${col}`;
  }

  parseStarCellKey(key) {
    const [row, col] = String(key).split("_").map(Number);
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0
    ) {
      return null;
    }
    return { row, col };
  }

  normalizeStarOffset(offset = {}) {
    const offsetX = Number(offset?.offsetX);
    const offsetY = Number(offset?.offsetY);

    return {
      offsetX: Number.isFinite(offsetX) ? offsetX : 0,
      offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    };
  }

  createStar(row, col, offset = this.createRandomGridOffset()) {
    return {
      id: this.createStarId(row, col),
      row,
      col,
      ...this.normalizeStarOffset(offset),
    };
  }

  /**
   * Creates a random normalized offset within a grid cell.
   *
   * Values are centered around 0 so renderers can convert them into local
   * cell-space offsets. Keeping the range within ±0.35 leaves some padding
   * from cell edges.
   *
   * @returns {{offsetX: number, offsetY: number}} Random offset values
   */
  createRandomGridOffset() {
    const range = this.rules.RANDOM_GRID_OFFSET_RANGE;
    return {
      offsetX: (Math.random() - 0.5) * range,
      offsetY: (Math.random() - 0.5) * range,
    };
  }

  /**
   * Generates random star positions using Fisher-Yates shuffle algorithm
   *
   * Pure function that generates stars without side effects.
   *
   * @param {number} gridSize - Grid dimension (1-4)
   * @returns {Array<{id: string, row: number, col: number, offsetX: number, offsetY: number}>} Array of star objects
   */
  generateRandomStars(gridSize) {
    const validSize = this.validateGridSize(gridSize);
    const starCount = this.calculateStarCount(validSize);

    // Generate all possible grid cells
    const allCells = [];
    for (let row = 0; row < validSize; row++) {
      for (let col = 0; col < validSize; col++) {
        allCells.push({ row, col });
      }
    }

    // Fisher-Yates shuffle for random selection
    for (let i = allCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCells[i], allCells[j]] = [allCells[j], allCells[i]];
    }

    const selectedCells = allCells.slice(0, starCount);

    const stars = selectedCells.map((cell) =>
      this.createStar(cell.row, cell.col),
    );

    return stars;
  }

  /**
   * Increments the score by 1
   *
   * @returns {number} New score value
   */
  incrementScore() {
    this.score++;
    return this.score;
  }

  /**
   * Collects a star (removes it from stars array) and increments score
   *
   * @param {string} starId - ID of the star to collect
   * @returns {Object} Result object with newScore and remainingStars
   * @returns {number} result.newScore - Updated score
   * @returns {Array} result.remainingStars - Stars array with collected star removed
   */
  collectStar(starId) {
    const cell = this.parseStarId(starId);
    if (!cell) return null;

    const remainingStars = this.stars.filter((s) => s.id !== starId);
    const newScore = this.incrementScore();

    // Update internal state
    this.stars = remainingStars;
    this.score = newScore;

    return {
      cell,
      newScore,
      remainingStars,
    };
  }

  parseStarCellValue(value) {
    if (value === true) return this.normalizeStarOffset();

    if (typeof value === "string") {
      const [offsetX, offsetY] = value.split(",").map(Number);
      if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
        return { offsetX, offsetY };
      }
    }

    if (value && typeof value === "object") {
      return this.normalizeStarOffset(value);
    }

    return null;
  }

  encodeStarCellValue(offset) {
    const normalized = this.normalizeStarOffset(offset);
    return `${normalized.offsetX},${normalized.offsetY}`;
  }

  createStarCellState(stars = []) {
    const state = new Map();
    if (!Array.isArray(stars)) return state;

    stars.forEach((star) => {
      const row = Number(star?.row);
      const col = Number(star?.col);
      if (
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        row < 0 ||
        col < 0
      ) {
        return;
      }
      state.set(
        this.createStarCellKey(row, col),
        this.normalizeStarOffset(star),
      );
    });

    return state;
  }

  starsFromCellState(cellState) {
    const stars = [];
    if (!cellState) return stars;

    for (const [key, offset] of cellState) {
      if (!offset) continue;

      const cell = this.parseStarCellKey(key);
      if (!cell) continue;
      stars.push(this.createStar(cell.row, cell.col, offset));
    }

    return stars;
  }

  toggleStarCellState(cellState, row, col) {
    const nextState = new Map(cellState);
    const key = this.createStarCellKey(row, col);

    if (nextState.has(key)) {
      nextState.delete(key);
    } else {
      nextState.set(key, this.createRandomGridOffset());
    }

    return nextState;
  }

  createStarCommit(pendingState, currentStars, currentCellState) {
    const stars = this.starsFromCellState(pendingState);
    const targetKeys = new Set(
      stars.map((star) => this.createStarCellKey(star.row, star.col)),
    );
    const currentKeys = new Set(
      (Array.isArray(currentStars) ? currentStars : []).map((star) =>
        this.createStarCellKey(star.row, star.col),
      ),
    );
    const sourceState =
      currentCellState ?? this.createStarCellState(currentStars);
    const keysToClear = [];

    for (const [key, exists] of sourceState) {
      if (exists && !targetKeys.has(key)) keysToClear.push(key);
    }

    return {
      stars,
      keysToClear,
      isSameVisibleStars:
        stars.length === currentKeys.size &&
        stars.every((star) =>
          currentKeys.has(this.createStarCellKey(star.row, star.col)),
        ),
    };
  }

  /**
   * Normalizes layout-clear progress to the valid range.
   *
   * @param {number} progress - Raw progress value
   * @param {number} [requiredClears=GAME_RULES.REQUIRED_LAYOUT_CLEARS] - Clears required to complete the layout
   * @returns {number} Normalized progress value
   */
  normalizeLayoutProgress(
    progress,
    requiredClears = this.rules.REQUIRED_LAYOUT_CLEARS,
  ) {
    const parsedRequired = Number(requiredClears);
    const safeRequired =
      Number.isFinite(parsedRequired) && parsedRequired > 0
        ? Math.round(parsedRequired)
        : this.rules.REQUIRED_LAYOUT_CLEARS;

    const parsedProgress = Number(progress);
    if (!Number.isFinite(parsedProgress) || parsedProgress < 0) return 0;

    return Math.min(safeRequired, Math.round(parsedProgress));
  }

  /**
   * Determines whether the current grid layout has been completed.
   *
   * @param {number} progress - Current layout-clear progress
   * @param {number} [requiredClears=GAME_RULES.REQUIRED_LAYOUT_CLEARS] - Clears required to complete the layout
   * @returns {boolean} True when enough clears have been earned
   */
  isLayoutComplete(
    progress,
    requiredClears = this.rules.REQUIRED_LAYOUT_CLEARS,
  ) {
    return (
      this.normalizeLayoutProgress(progress, requiredClears) >= requiredClears
    );
  }

  /**
   * Calculates the next layout-clear progress value after a cleared layout.
   *
   * @param {number} progress - Current layout-clear progress
   * @param {number} [requiredClears=GAME_RULES.REQUIRED_LAYOUT_CLEARS] - Clears required to complete the layout
   * @returns {number} Updated progress value
   */
  getNextLayoutProgress(
    progress,
    requiredClears = this.rules.REQUIRED_LAYOUT_CLEARS,
  ) {
    return this.normalizeLayoutProgress(progress + 1, requiredClears);
  }

  /**
   * Determines whether the player can advance to the next grid size.
   *
   * @param {number} progress - Current layout-clear progress
   * @param {number} gridSize - Current grid size
   * @param {number} [requiredClears=GAME_RULES.REQUIRED_LAYOUT_CLEARS] - Clears required to complete the layout
   * @returns {boolean} True when the layout is complete and a larger grid exists
   */
  canIncreaseGrid(
    progress,
    gridSize,
    requiredClears = this.rules.REQUIRED_LAYOUT_CLEARS,
  ) {
    return (
      this.isLayoutComplete(progress, requiredClears) &&
      this.validateGridSize(gridSize) < this.rules.GRID_MAX_SIZE
    );
  }

  /**
   * Gets the next grid size, clamped to the configured maximum.
   *
   * @param {number} gridSize - Current grid size
   * @returns {number} Next grid size
   */
  getNextGridSize(gridSize) {
    return this.validateGridSize(this.validateGridSize(gridSize) + 1);
  }

  getModeForParticipantPresence(participantActive) {
    return participantActive === true
      ? GAME_MODES.MULTIPLAYER
      : GAME_MODES.SINGLE_PLAYER;
  }

  /**
   * Determines whether automatic single-player star generation should run.
   *
   * @param {Object} state - Current game state
   * @param {boolean} state.isHost - Whether this client is host
   * @param {number} state.progress - Current layout-clear progress
   * @param {Array} state.stars - Current stars array
   * @param {boolean} state.isMultiplayerMode - Whether multiplayer mode is active
   * @param {number} [state.requiredClears=GAME_RULES.REQUIRED_LAYOUT_CLEARS] - Clears required to complete the layout
   * @returns {boolean} True when stars should be generated automatically
   */
  shouldGenerateSinglePlayerStars({
    isHost,
    progress,
    stars,
    isMultiplayerMode,
    requiredClears = this.rules.REQUIRED_LAYOUT_CLEARS,
  }) {
    return (
      isHost === true &&
      !this.isLayoutComplete(progress, requiredClears) &&
      !isMultiplayerMode &&
      (!stars || stars.length === 0)
    );
  }

  /**
   * Sets the game mode and returns actions to take
   *
   * Pure logic for mode switching - returns what should happen,
   * but doesn't perform side effects.
   *
   * @param {string} mode - "single-player" or "multiplayer"
   * @param {boolean} currentIsMultiplayer - Current multiplayer state
   * @returns {Object} Mode change result
   * @returns {boolean} result.isMultiplayer - New multiplayer state
   * @returns {boolean} result.shouldClearStars - Whether to clear stars
   * @returns {boolean} result.shouldGenerateStars - Whether to generate new stars
   */
  setGameMode(mode, currentIsMultiplayer) {
    const isMultiplayer = mode === GAME_MODES.MULTIPLAYER;

    // Skip if no change
    if (currentIsMultiplayer === isMultiplayer) {
      return {
        isMultiplayer,
        shouldClearStars: false,
        shouldGenerateStars: false,
        changed: false,
      };
    }

    if (isMultiplayer) {
      // MULTIPLAYER MODE: Clear stars, host will place manually
      return {
        isMultiplayer: true,
        shouldClearStars: true,
        shouldGenerateStars: false,
        changed: true,
      };
    } else {
      // SINGLE-PLAYER MODE: Generate random stars
      return {
        isMultiplayer: false,
        shouldClearStars: false,
        shouldGenerateStars: true,
        changed: true,
      };
    }
  }

  /**
   * Sets the grid size (validates and updates internal state)
   *
   * @param {number} size - New grid size
   * @returns {number} Validated grid size
   */
  setGridSize(size) {
    this.gridSize = this.validateGridSize(size);
    return this.gridSize;
  }

  /**
   * Sets the stars array (for syncing from external source)
   *
   * @param {Array<{id: string, row: number, col: number, offsetX?: number, offsetY?: number}>} stars - Stars array
   */
  setStars(stars) {
    this.stars = Array.isArray(stars) ? stars : [];
  }

  /**
   * Sets the score (for syncing from external source)
   *
   * @param {number} score - New score value
   */
  setScore(score) {
    const n = Number(score);
    if (Number.isFinite(n) && n >= 0) {
      this.score = n;
    }
  }

  /**
   * Gets current game state snapshot
   *
   * @returns {Object} Current game state
   */
  getState() {
    return {
      score: this.score,
      gridSize: this.gridSize,
      isMultiplayerMode: this.isMultiplayerMode,
      stars: [...this.stars], // Return copy to prevent mutation
    };
  }
}

export default GameService;
export { GameService };
