function clipText(value, maxLength = 4000) {
  return String(value || "").slice(0, maxLength);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeIssue(issue = {}) {
  return {
    id: clipText(issue.id, 120),
    severity: issue.severity === "error" ? "error" : "warning",
    title: clipText(issue.title, 180),
    description: clipText(issue.description, 360),
    suggestion: clipText(issue.suggestion, 360),
    details: asArray(issue.details)
      .slice(0, 8)
      .map((detail) => clipText(detail, 220)),
    target: issue.target
      ? {
          type: clipText(issue.target.type, 80),
          id: clipText(issue.target.id, 80),
          groudId: clipText(issue.target.groudId, 80),
          boundaryIds: asArray(issue.target.boundaryIds)
            .slice(0, 6)
            .map((id) => clipText(id, 80)),
          pointIds: asArray(issue.target.pointIds)
            .slice(0, 8)
            .map((id) => clipText(id, 80)),
        }
      : undefined,
  };
}

function normalizeLane(lane = {}) {
  return {
    id: clipText(lane.id, 80),
    speed: Number(lane.speed) || 0,
    direction: lane.direction,
    possibleDirection: lane.possibleDirection,
    trend: lane.trend,
    width: Number(lane.width) || 0,
    leftBoundaryId: clipText(lane.leftBoundaryId, 80),
    rightBoundaryId: clipText(lane.rightBoundaryId, 80),
    predecessors: asArray(lane.predecessors)
      .slice(0, 8)
      .map((id) => clipText(id, 80)),
    successors: asArray(lane.successors)
      .slice(0, 8)
      .map((id) => clipText(id, 80)),
    leftNeighbors: asArray(lane.leftNeighbors)
      .slice(0, 8)
      .map((id) => clipText(id, 80)),
    rightNeighbors: asArray(lane.rightNeighbors)
      .slice(0, 8)
      .map((id) => clipText(id, 80)),
  };
}

function normalizeAssistantContext(rawContext = {}) {
  const summary = rawContext.summary || {};
  return {
    mapName: clipText(rawContext.mapName, 120),
    currentOperation: clipText(rawContext.currentOperation, 80),
    publishGate: rawContext.publishGate
      ? {
          status: clipText(rawContext.publishGate.status, 40),
          title: clipText(rawContext.publishGate.title, 120),
          reason: clipText(rawContext.publishGate.reason, 260),
        }
      : undefined,
    summary: {
      lanes: Number(summary.lanes) || 0,
      laneEdges: Number(summary.laneEdges) || 0,
      laneComponents: Number(summary.laneComponents) || 0,
      errors: Number(summary.errors) || 0,
      warnings: Number(summary.warnings) || 0,
    },
    elementCounts: {
      points: Number(rawContext.elementCounts?.points) || 0,
      boundaries: Number(rawContext.elementCounts?.boundaries) || 0,
      grouds: Number(rawContext.elementCounts?.grouds) || 0,
      lanes: Number(rawContext.elementCounts?.lanes) || 0,
      trafficSignals: Number(rawContext.elementCounts?.trafficSignals) || 0,
      stopLines: Number(rawContext.elementCounts?.stopLines) || 0,
      signs: Number(rawContext.elementCounts?.signs) || 0,
    },
    selectedElements: asArray(rawContext.selectedElements)
      .slice(0, 12)
      .map((item) => ({
        id: clipText(item.id, 80),
        type: clipText(item.type, 80),
        threeObject: clipText(item.threeObject, 80),
        lane: item.lane ? normalizeLane(item.lane) : undefined,
      })),
    selectedIssues: asArray(rawContext.selectedIssues)
      .slice(0, 12)
      .map(normalizeIssue),
    topIssues: asArray(rawContext.topIssues)
      .slice(0, 24)
      .map(normalizeIssue),
    issueGuidance: asArray(rawContext.issueGuidance)
      .slice(0, 16)
      .map((item) => ({
        issueId: clipText(item.issueId, 120),
        severity: item.severity === "error" ? "error" : "warning",
        title: clipText(item.title, 180),
        category: clipText(item.category, 80),
        action: clipText(item.action, 360),
      })),
  };
}

function formatSummary(summary) {
  return `${summary.lanes} 条车道，${summary.laneEdges} 条前后继连接，${summary.laneComponents} 个拓扑块，` +
    `${summary.errors} 个错误，${summary.warnings} 个警告`;
}

function formatLane(lane) {
  const relation = [];
  if (lane.predecessors?.length) {
    relation.push(`前驱 ${lane.predecessors.join(", ")}`);
  }
  if (lane.successors?.length) {
    relation.push(`后继 ${lane.successors.join(", ")}`);
  }
  if (!relation.length) {
    relation.push("暂无前后继");
  }
  return `车道 ${lane.id}，限速 ${lane.speed || "-"} km/h，宽度 ${lane.width.toFixed(2)}m，` +
    `边界 ${lane.leftBoundaryId}/${lane.rightBoundaryId}，${relation.join("；")}`;
}

function formatSelected(selectedElements) {
  if (!selectedElements.length) {
    return "当前没有选中对象。";
  }
  return selectedElements
    .map((item) => (item.lane ? formatLane(item.lane) : `${item.type || item.threeObject} ${item.id}`))
    .join("\n");
}

function formatIssue(issue, index) {
  const lines = [`${index + 1}. [${issue.severity === "error" ? "错误" : "警告"}] ${issue.title}`];
  if (issue.suggestion) {
    lines.push(`   建议：${issue.suggestion}`);
  }
  issue.details?.slice(0, 3).forEach((detail) => lines.push(`   ${detail}`));
  return lines.join("\n");
}

function classifyQuestion(question) {
  const text = String(question || "").toLowerCase();
  return {
    asksPublish: /发布|release|deploy|能不能|阻断/.test(text),
    asksSelected: /选中|对象|这个|该车道|为什么/.test(text),
    asksCurve: /弯道|半径|环岛|连接|断点|curve|radius/.test(text),
    asksQuality: /质检|警告|错误|前驱|后继|拓扑|偏窄|宽度|半径|怎么去除|怎么处理/.test(text),
    asksPredecessor: /前驱|入口|predecessor/.test(text),
    asksSuccessor: /后继|出口|successor/.test(text),
    asksRadius: /半径|急弯|转弯|radius/.test(text),
    asksWidth: /偏窄|宽度|窄|width/.test(text),
    asksPlan: /12|优化|目标|进度|计划|下一步/.test(text),
  };
}

function summarizeGuidance(issueGuidance) {
  if (!issueGuidance.length) {
    return [];
  }
  const grouped = new Map();
  issueGuidance.forEach((item) => {
    const key = item.category || "其他";
    if (!grouped.has(key)) {
      grouped.set(key, {
        category: key,
        count: 0,
        errors: 0,
        examples: [],
        action: item.action,
      });
    }
    const group = grouped.get(key);
    group.count += 1;
    if (item.severity === "error") {
      group.errors += 1;
    }
    if (group.examples.length < 3) {
      group.examples.push(item.title);
    }
  });
  return Array.from(grouped.values());
}

function formatGuidanceGroup(group, index) {
  const level = group.errors > 0 ? `${group.errors} 个错误` : "警告";
  const examples = group.examples.length ? `；例如：${group.examples.join("、")}` : "";
  return `${index + 1}. ${group.category}（${group.count} 项，${level}）：${group.action}${examples}`;
}

function buildLocalMapAssistantReply(question, context) {
  const {
    summary,
    selectedElements,
    selectedIssues,
    topIssues,
    mapName,
    publishGate,
    issueGuidance = [],
  } = context;
  const blockers = topIssues.filter((issue) => issue.severity === "error");
  const warnings = topIssues.filter((issue) => issue.severity !== "error");
  const selectedBlockers = selectedIssues.filter((issue) => issue.severity === "error");
  const selectedWarnings = selectedIssues.filter((issue) => issue.severity !== "error");
  const intent = classifyQuestion(question);
  const lines = [];

  lines.push(`我已读取当前地图${mapName ? `「${mapName}」` : ""}的上下文。`);
  lines.push(`概况：${formatSummary(summary)}。`);
  if (publishGate?.title) {
    lines.push(`发布门禁：${publishGate.title}${publishGate.reason ? `，${publishGate.reason}` : ""}。`);
  }

  if (intent.asksSelected || selectedElements.length) {
    lines.push("");
    lines.push("选中对象：");
    lines.push(formatSelected(selectedElements));
    if (selectedIssues.length) {
      lines.push("");
      lines.push("与选中对象直接相关的问题：");
      selectedIssues.slice(0, 6).forEach((issue, index) => lines.push(formatIssue(issue, index)));
    }
  }

  if (intent.asksPublish || blockers.length) {
    lines.push("");
    if (blockers.length) {
      lines.push("当前发布会被这些错误阻断，优先处理：");
      blockers.slice(0, 6).forEach((issue, index) => lines.push(formatIssue(issue, index)));
    } else {
      lines.push("当前没有红色阻断错误，可以进入发布；黄色警告仍建议在仿真里确认。");
    }
  }

  if (intent.asksQuality) {
    const guidanceGroups = summarizeGuidance(issueGuidance);
    lines.push("");
    lines.push("质检警告处理原则：");
    lines.push("1. 红色错误必须先清掉，否则不建议发布。黄色警告分两类：合法入口/出口/低速场景可以保留；断点、错误连接、过窄、过急转弯需要修。");
    lines.push("2. 每修一类问题后重新质检，不要一次改太多，否则很难判断是哪一步引入新问题。");
    if (guidanceGroups.length) {
      lines.push("");
      lines.push("当前地图按类别建议这样处理：");
      guidanceGroups.slice(0, 6).forEach((group, index) => lines.push(formatGuidanceGroup(group, index)));
    }
  }

  if (intent.asksPredecessor) {
    lines.push("");
    lines.push("没有前驱的判断：");
    lines.push("1. 如果这条车道是地图入口、停车场入口或采图起点，可以保留为黄色警告。");
    lines.push("2. 如果它位于道路中间，就说明上一段没接上：选中它和上一段车道，直线延续用直道连接，有转向用弯道连接。");
    lines.push("3. 连接后仍提示没有前驱时，优先检查两条车道的箭头方向是否接反。");
  }

  if (intent.asksSuccessor) {
    lines.push("");
    lines.push("没有后继的判断：");
    lines.push("1. 如果这条车道是地图出口或道路终点，可以保留为黄色警告。");
    lines.push("2. 如果车辆应继续行驶，就把它连接到下一段车道；连接后看后继方向和车道箭头是否一致。");
  }

  if (intent.asksRadius) {
    lines.push("");
    lines.push("转弯半径小的处理：");
    lines.push("1. 小于 2m 按硬错误处理，拉开端点或重建弯道，不建议靠降低限速掩盖。");
    lines.push("2. 2m 到 4.5m 是低速风险段，可以先降低限速，但必须在 Dreamview/仿真里看车辆是否压线、抖动或过不了。");
    lines.push("3. 环岛和 90 度转角优先重建弯道连接，让中心线更平滑，同时检查最小宽度。");
  }

  if (intent.asksWidth) {
    lines.push("");
    lines.push("车道偏窄的处理：");
    lines.push("1. 自动连接段如果变成楔形或最窄处低于 2.6m，优先删除并重新用弯道连接生成。");
    lines.push("2. 手动画的窄道需要拉开左右边界；确实是窄入口时要降速并仿真确认。");
  }

  if (!blockers.length && warnings.length && !selectedIssues.length) {
    lines.push("");
    lines.push("剩余主要警告：");
    warnings.slice(0, 5).forEach((issue, index) => lines.push(formatIssue(issue, index)));
  }

  if (intent.asksCurve) {
    lines.push("");
    lines.push("弯道/断点处理建议：");
    lines.push("1. 先确认两条候选车道方向一致，端点位于彼此前方，不要用反向端点硬连。");
    lines.push("2. 端点间距离很短且方向近似一致时用直道连接；存在明显转向时用弯道连接。");
    lines.push("3. 半径低于 2.0m 仍按硬错误处理；2.0m 到 3.0m 只适合低速车道并需要仿真确认。");
    lines.push("4. 弯道生成后重点看左/右边界是否交叉、最窄宽度是否低于 1.8m。");
  }

  if (intent.asksPlan) {
    lines.push("");
    lines.push("按既定目标，AI 助手继续围绕三件事优化：");
    lines.push("1. 读懂当前地图状态：车道拓扑、质检、选中对象、发布门禁。");
    lines.push("2. 输出可执行步骤：先修阻断错误，再处理警告，最后发布和仿真验证。");
    lines.push("3. 后续接入半自动修复：先解释风险和改动范围，再让用户确认执行。");
  }

  if (selectedBlockers.length || selectedWarnings.length) {
    lines.push("");
    lines.push("对当前选中对象，我建议下一步先做：");
    const firstIssue = selectedBlockers[0] || selectedWarnings[0];
    lines.push(`- 定位：${firstIssue.title}`);
    lines.push(`- 操作：${firstIssue.suggestion || "在质检面板中定位该对象，按提示补齐几何或拓扑关系。"}`);
  } else if (blockers.length) {
    lines.push("");
    lines.push("下一步：在“质检”页从第一个红色错误开始定位，修完后重新打开 AI 助手确认门禁变化。");
  } else {
    lines.push("");
    lines.push("下一步：可以发布地图，然后在 Dreamview/仿真里确认低速弯道、环岛和断点附近的通过性。");
  }

  return lines.join("\n");
}

function buildOpenAIPrompt(question, context, localBaseline) {
  return {
    question,
    context,
    localBaseline,
    instructions: [
      "你是地图编辑器内置的工程诊断助手。",
      "只能根据提供的地图上下文回答，不要编造工具、接口或已完成的修改。",
      "优先处理发布阻断错误，其次处理影响仿真通过性的警告。",
      "如果用户问选中对象，先解释该对象的风险，再给可执行操作步骤。",
      "如果用户问弯道、环岛、断点，必须覆盖方向、端点距离、半径、宽度、边界交叉。",
      "如果用户问质检警告，必须说明哪些可以保留、哪些必须修，并给出前驱/后继/半径/宽度的判断规则。",
      "回答要短而具体，使用中文，不要营销化表达。",
    ],
  };
}

module.exports = {
  clipText,
  normalizeAssistantContext,
  buildLocalMapAssistantReply,
  buildOpenAIPrompt,
};
