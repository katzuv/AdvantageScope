import { GraphColors, ensureThemeContrast } from "../../shared/Colors";
import { SourceListConfig, SourceListItemState, SourceListState } from "../../shared/SourceListConfig";
import { getEnabledKey, getLogValueText } from "../../shared/log/LogUtil";
import {
  LineGraphRendererCommand,
  LineGraphRendererCommand_DiscreteField,
  LineGraphRendererCommand_NumericField
} from "../../shared/renderers/LineGraphRenderer";
import { UnitConversionPreset, convertWithPreset } from "../../shared/units";
import { clampValue, scaleValue } from "../../shared/util";
import SourceList from "../SourceList";
import TabController from "./TabController";

export default class LineGraphController implements TabController {
  private RANGE_MARGIN = 0.05;
  private MIN_AXIS_RANGE = 1e-5;
  private MAX_AXIS_RANGE = 1e20;
  private MAX_VALUE = 1e20;

  private leftSourceList: SourceList;
  private discreteSourceList: SourceList;
  private rightSourceList: SourceList;

  private leftLockedRange: [number, number] | null = null;
  private rightLockedRange: [number, number] | null = null;
  private leftUnitConversion: UnitConversionPreset = {
    type: null,
    factor: 1
  };
  private rightUnitConversion: UnitConversionPreset = {
    type: null,
    factor: 1
  };

  constructor(root: HTMLElement) {
    // Make source lists
    this.leftSourceList = new SourceList(
      root.getElementsByClassName("line-graph-left")[0] as HTMLElement,
      NumericAxisConfig
    );
    this.leftSourceList.setTitle("Left Axis");

    this.rightSourceList = new SourceList(
      root.getElementsByClassName("line-graph-right")[0] as HTMLElement,
      NumericAxisConfig
    );
    this.rightSourceList.setTitle("Right Axis");

    this.discreteSourceList = new SourceList(
      root.getElementsByClassName("line-graph-discrete")[0] as HTMLElement,
      DiscreteFieldsConfig
    );

    // Edit axis handling
    let leftExitAxisButton = root.getElementsByClassName("line-graph-edit-left")[0];
    leftExitAxisButton.addEventListener("click", () => {
      let rect = leftExitAxisButton.getBoundingClientRect();
      window.sendMainMessage("ask-edit-axis", {
        x: Math.round(rect.right),
        y: Math.round(rect.top),
        legend: "left",
        lockedRange: this.leftLockedRange,
        unitConversion: this.leftUnitConversion
      });
    });

    let rightExitAxisButton = root.getElementsByClassName("line-graph-edit-right")[0];
    rightExitAxisButton.addEventListener("click", () => {
      let rect = rightExitAxisButton.getBoundingClientRect();
      window.sendMainMessage("ask-edit-axis", {
        x: Math.round(rect.right),
        y: Math.round(rect.top),
        legend: "right",
        lockedRange: this.rightLockedRange,
        unitConversion: this.rightUnitConversion
      });
    });

    let discreteEditAxisButton = root.getElementsByClassName("line-graph-edit-discrete")[0];
    discreteEditAxisButton.addEventListener("click", () => {
      let rect = discreteEditAxisButton.getBoundingClientRect();
      window.sendMainMessage("ask-edit-axis", {
        x: Math.round(rect.right),
        y: Math.round(rect.top),
        legend: "discrete"
      });
    });
  }

  saveState(): unknown {
    return {
      leftSources: this.leftSourceList.getState(),
      rightSources: this.rightSourceList.getState(),
      discreteSources: this.discreteSourceList.getState(),

      leftLockedRange: this.leftLockedRange,
      rightLockedRange: this.rightLockedRange,

      leftUnitConversion: this.leftUnitConversion,
      rightUnitConversion: this.rightUnitConversion
    };
  }

  restoreState(state: unknown): void {
    if (typeof state !== "object" || state === null) return;

    if ("leftLockedRange" in state) {
      this.leftLockedRange = state.leftLockedRange as [number, number] | null;
    }
    if ("rightLockedRange" in state) {
      this.rightLockedRange = state.rightLockedRange as [number, number] | null;
    }
    if ("leftUnitConversion" in state) {
      this.leftUnitConversion = state.leftUnitConversion as UnitConversionPreset;
    }
    if ("rightUnitConversion" in state) {
      this.rightUnitConversion = state.rightUnitConversion as UnitConversionPreset;
    }
    this.updateAxisLabels();

    if ("leftSources" in state) {
      this.leftSourceList.setState(state.leftSources as SourceListItemState[]);
    }
    if ("rightSources" in state) {
      this.rightSourceList.setState(state.rightSources as SourceListItemState[]);
    }
    if ("discreteSources" in state) {
      this.discreteSourceList.setState(state.discreteSources as SourceListItemState[]);
    }
  }

  /** Updates the axis labels based on the locked and unit conversion status. */
  private updateAxisLabels() {
    let leftLocked = this.leftLockedRange !== null;
    let leftConverted = this.leftUnitConversion.type !== null || this.leftUnitConversion.factor !== 1;
    if (leftLocked && leftConverted) {
      this.leftSourceList.setTitle("Left Axis [Locked, Converted]");
    } else if (leftLocked) {
      this.leftSourceList.setTitle("Left Axis [Locked]");
    } else if (leftConverted) {
      this.leftSourceList.setTitle("Left Axis [Converted]");
    } else {
      this.leftSourceList.setTitle("Left Axis");
    }

    let rightLocked = this.rightLockedRange !== null;
    let rightConverted = this.rightUnitConversion.type !== null || this.rightUnitConversion.factor !== 1;
    if (rightLocked && rightConverted) {
      this.rightSourceList.setTitle("Right Axis [Locked, Converted]");
    } else if (rightLocked) {
      this.rightSourceList.setTitle("Right Axis [Locked]");
    } else if (rightConverted) {
      this.rightSourceList.setTitle("Right Axis [Converted]");
    } else {
      this.rightSourceList.setTitle("Right Axis");
    }
  }

  /** Adjusts the locked range and unit conversion for an axis. */
  editAxis(legend: string, lockedRange: [number, number] | null, unitConversion: UnitConversionPreset) {
    switch (legend) {
      case "left":
        if (lockedRange === null) {
          this.leftLockedRange = null;
        } else if (lockedRange[0] === null && lockedRange[1] === null) {
          this.leftLockedRange = this.getCommand().leftRange;
        } else {
          this.leftLockedRange = lockedRange;
        }
        this.leftUnitConversion = unitConversion;
        break;

      case "right":
        if (lockedRange === null) {
          this.rightLockedRange = null;
        } else if (lockedRange[0] === null && lockedRange[1] === null) {
          this.rightLockedRange = this.getCommand().rightRange;
        } else {
          this.rightLockedRange = lockedRange;
        }
        this.rightUnitConversion = unitConversion;
        break;
    }
    this.updateAxisLabels();
  }

  /** Clears the fields for an axis. */
  clearAxis(legend: string) {
    switch (legend) {
      case "left":
        this.leftSourceList.clear();
        break;
      case "right":
        this.rightSourceList.clear();
        break;
      case "discrete":
        this.discreteSourceList.clear();
        break;
    }
  }

  /** Adds the enabled field to the discrete axis. */
  addDiscreteEnabled() {
    let enabledKey = getEnabledKey(window.log);
    if (enabledKey !== undefined) {
      this.discreteSourceList.addField(enabledKey);
    }
  }

  refresh(): void {}

  newAssets(): void {}

  getActiveFields(): string[] {
    return [
      ...this.leftSourceList.getActiveFields(),
      ...this.discreteSourceList.getActiveFields(),
      ...this.rightSourceList.getActiveFields()
    ];
  }

  getCommand(): LineGraphRendererCommand {
    let leftDataRange: [number, number] = [Infinity, -Infinity];
    let rightDataRange: [number, number] = [Infinity, -Infinity];
    let leftFieldsCommand: LineGraphRendererCommand_NumericField[] = [];
    let rightFieldsCommand: LineGraphRendererCommand_NumericField[] = [];
    let discreteFieldsCommand: LineGraphRendererCommand_DiscreteField[] = [];
    const timeRange = window.selection.getTimelineRange();

    // Add numeric fields
    let addNumeric = (
      source: SourceListState,
      dataRange: [number, number],
      command: LineGraphRendererCommand_NumericField[],
      unitConversion: UnitConversionPreset
    ) => {
      source.forEach((fieldItem) => {
        if (!fieldItem.visible) return;

        let data = window.log.getNumber(fieldItem.logKey, timeRange[0], timeRange[1]);
        if (data === undefined) return;
        data.values = data.values.map((value) =>
          clampValue(convertWithPreset(value, unitConversion), -this.MAX_VALUE, this.MAX_VALUE)
        );

        // Trim early point
        if (data.timestamps.length > 0 && data.timestamps[0] < timeRange[0]) {
          switch (fieldItem.type) {
            case "stepped":
              // Keep, adjust timestamp
              data.timestamps[0] = timeRange[0];
              break;
            case "smooth":
              // Interpolate to displayed value
              if (data.timestamps.length >= 2) {
                data.values[0] = scaleValue(
                  timeRange[0],
                  [data.timestamps[0], data.timestamps[1]],
                  [data.values[0], data.values[1]]
                );
                data.timestamps[0] = timeRange[0];
              }
              break;
            case "points":
              // Remove, no effect on displayed range
              data.timestamps.shift();
              data.values.shift();
              break;
          }
        }

        // Trim late point
        if (data.timestamps.length > 0 && data.timestamps[data.timestamps.length - 1] > timeRange[1]) {
          switch (fieldItem.type) {
            case "stepped":
            case "points":
              // Remove, no effect on displayed range
              data.timestamps.pop();
              data.values.pop();
              break;
            case "smooth":
              // Interpolate to displayed value
              if (data.timestamps.length >= 2) {
                data.values[data.values.length - 1] = scaleValue(
                  timeRange[1],
                  [data.timestamps[data.timestamps.length - 2], data.timestamps[data.timestamps.length - 1]],
                  [data.values[data.values.length - 2], data.values[data.values.length - 1]]
                );
                data.timestamps[data.timestamps.length - 1] = timeRange[1];
              }
              break;
          }
        }

        // Update data range
        data.values.forEach((value) => {
          if (value < dataRange[0]) dataRange[0] = value;
          if (value > dataRange[1]) dataRange[1] = value;
        });

        // Add field command
        command.push({
          timestamps: data.timestamps,
          values: data.values,
          color: ensureThemeContrast(fieldItem.options.color),
          type: fieldItem.type as "smooth" | "stepped" | "points",
          size: fieldItem.options.size as "normal" | "bold" | "verybold"
        });
      });
    };
    addNumeric(this.leftSourceList.getState(), leftDataRange, leftFieldsCommand, this.leftUnitConversion);
    addNumeric(this.rightSourceList.getState(), rightDataRange, rightFieldsCommand, this.rightUnitConversion);

    // Add discrete fields
    this.discreteSourceList.getState().forEach((fieldItem) => {
      if (!fieldItem.visible) return;

      let data = window.log.getRange(fieldItem.logKey, timeRange[0], timeRange[1]);
      if (data === undefined) return;

      // Get toggle reference
      let toggleReference = window.log.getTimestamps([fieldItem.logKey]).indexOf(data.timestamps[0]) % 2 === 0;
      toggleReference = toggleReference !== window.log.getStripingReference(fieldItem.logKey);
      if (typeof data.values[0] === "boolean") toggleReference = !data.values[0];

      // Adjust early point
      if (data.timestamps.length > 0 && data.timestamps[0] < timeRange[0]) {
        data.timestamps[0] = timeRange[0];
      }

      // Trim late point
      if (data.timestamps.length > 0 && data.timestamps[data.timestamps.length - 1] > timeRange[1]) {
        data.timestamps.pop();
        data.values.pop();
      }

      // Convert to text
      let logType = window.log.getType(fieldItem.logKey);
      if (logType === null) return;
      data.values = data.values.map((value) => getLogValueText(value, logType!));

      // Add field command
      discreteFieldsCommand.push({
        timestamps: data.timestamps,
        values: data.values,
        color: ensureThemeContrast(fieldItem.options.color),
        type: fieldItem.type as "stripes" | "graph",
        toggleReference: toggleReference
      });
    });

    // Get numeric ranges
    let calcRange = (dataRange: [number, number], lockedRange: [number, number] | null): [number, number] => {
      let range: [number, number];
      if (lockedRange === null) {
        let margin = (dataRange[1] - dataRange[0]) * this.RANGE_MARGIN;
        range = [dataRange[0] - margin, dataRange[1] + margin];
      } else {
        range = lockedRange;
      }
      if (!isFinite(range[0])) range[0] = -1;
      if (!isFinite(range[1])) range[1] = 1;
      return this.limitAxisRange(range);
    };
    let leftRange = calcRange(leftDataRange, this.leftLockedRange);
    let rightRange = calcRange(rightDataRange, this.rightLockedRange);
    let showLeftAxis = this.leftLockedRange !== null || leftFieldsCommand.length > 0;
    let showRightAxis = this.rightLockedRange !== null || rightFieldsCommand.length > 0;
    if (!showLeftAxis && !showRightAxis) {
      showLeftAxis = true;
    }

    // Return command
    return {
      timeRange: timeRange,
      selectionMode: window.selection.getMode(),
      selectedTime: window.selection.getSelectedTime(),
      hoveredTime: window.selection.getHoveredTime(),

      leftRange: leftRange,
      rightRange: rightRange,
      showLeftAxis: showLeftAxis,
      showRightAxis: showRightAxis,
      priorityAxis: this.leftLockedRange === null && this.rightLockedRange !== null ? "right" : "left",
      leftFields: leftFieldsCommand,
      rightFields: rightFieldsCommand,
      discreteFields: discreteFieldsCommand
    };
  }

  /** Adjusts the range to fit the extreme limits. */
  private limitAxisRange(range: [number, number]): [number, number] {
    let adjustedRange = [range[0], range[1]] as [number, number];
    if (adjustedRange[0] > this.MAX_VALUE) {
      adjustedRange[0] = this.MAX_VALUE;
    }
    if (adjustedRange[1] > this.MAX_VALUE) {
      adjustedRange[1] = this.MAX_VALUE;
    }
    if (adjustedRange[0] < -this.MAX_VALUE) {
      adjustedRange[0] = -this.MAX_VALUE;
    }
    if (adjustedRange[1] < -this.MAX_VALUE) {
      adjustedRange[1] = -this.MAX_VALUE;
    }
    if (adjustedRange[0] === adjustedRange[1]) {
      if (Math.abs(adjustedRange[0]) >= this.MAX_VALUE) {
        if (adjustedRange[0] > 0) {
          adjustedRange[0] *= 0.8;
        } else {
          adjustedRange[1] *= 0.8;
        }
      } else {
        adjustedRange[0]--;
        adjustedRange[1]++;
      }
    }
    if (adjustedRange[1] - adjustedRange[0] > this.MAX_AXIS_RANGE) {
      if (adjustedRange[0] + this.MAX_AXIS_RANGE < this.MAX_VALUE) {
        adjustedRange[1] = adjustedRange[0] + this.MAX_AXIS_RANGE;
      } else {
        adjustedRange[0] = adjustedRange[1] - this.MAX_AXIS_RANGE;
      }
    }
    if (adjustedRange[1] - adjustedRange[0] < this.MIN_AXIS_RANGE) {
      adjustedRange[1] = adjustedRange[0] + this.MIN_AXIS_RANGE;
    }
    return adjustedRange;
  }
}

const NumericAxisConfig: SourceListConfig = {
  title: "",
  autoAdvance: "color",
  types: [
    {
      key: "stepped",
      display: "Stepped",
      symbol: "stairs",
      showInTypeName: false,
      color: "color",
      sourceTypes: ["Number"],
      options: [
        {
          key: "color",
          display: "Color",
          showInTypeName: false,
          values: GraphColors
        },
        {
          key: "size",
          display: "Thickness",
          showInTypeName: false,
          values: [
            { key: "normal", display: "Normal" },
            { key: "bold", display: "Bold" },
            { key: "verybold", display: "Very Bold" }
          ]
        }
      ]
    },
    {
      key: "smooth",
      display: "Smooth",
      symbol: "scribble.variable",
      showInTypeName: false,
      color: "color",
      sourceTypes: ["Number"],
      options: [
        {
          key: "color",
          display: "Color",
          showInTypeName: false,
          values: GraphColors
        },
        {
          key: "size",
          display: "Thickness",
          showInTypeName: false,
          values: [
            { key: "normal", display: "Normal" },
            { key: "bold", display: "Bold" },
            { key: "verybold", display: "Very Bold" }
          ]
        }
      ]
    },
    {
      key: "points",
      display: "Points",
      symbol: "smallcircle.filled.circle",
      showInTypeName: false,
      color: "color",
      sourceTypes: ["Number"],
      options: [
        {
          key: "color",
          display: "Color",
          showInTypeName: false,
          values: GraphColors
        },
        {
          key: "size",
          display: "Size",
          showInTypeName: false,
          values: [
            { key: "normal", display: "Normal" },
            { key: "bold", display: "Large" }
          ]
        }
      ]
    }
  ]
};

const DiscreteFieldsConfig: SourceListConfig = {
  title: "Discrete Fields",
  autoAdvance: "color",
  types: [
    {
      key: "stripes",
      display: "Stripes",
      symbol: "square.stack.3d.forward.dottedline.fill",
      showInTypeName: false,
      color: "color",
      sourceTypes: ["Raw", "Boolean", "Number", "String", "BooleanArray", "NumberArray", "StringArray"],
      options: [
        {
          key: "color",
          display: "Color",
          showInTypeName: false,
          values: GraphColors
        }
      ]
    },
    {
      key: "graph",
      display: "Graph",
      symbol: "chart.xyaxis.line",
      showInTypeName: false,
      color: "color",
      sourceTypes: ["Raw", "Boolean", "Number", "String", "BooleanArray", "NumberArray", "StringArray"],
      options: [
        {
          key: "color",
          display: "Color",
          showInTypeName: false,
          values: GraphColors
        }
      ]
    }
  ]
};