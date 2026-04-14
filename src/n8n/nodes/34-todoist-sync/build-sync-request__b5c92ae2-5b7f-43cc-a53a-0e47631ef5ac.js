'use strict';

const ALLOWED_PROJECTS = {
  'home 🏡': 'home',
  home: 'home',
  personal: 'personal',
  work: 'work',
  inbox: 'inbox',
};

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function lower(value) {
  return asText(value).toLowerCase();
}

function parseParentTaskId(task) {
  const row = task && typeof task === 'object' ? task : {};
  return asText(row.parent_id || row.parentId || row.parent_task_id || row.parentTaskId) || null;
}

function hasExplicitProjectSignal(rawTitle) {
  const title = asText(rawTitle);
  if (!title) return false;
  return /^prj\s*:/i.test(title) || /^\[prj\]/i.test(title) || /^project\s*:/i.test(title);
}

function flattenNodeJson(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const item of items) {
    const json = item && typeof item === 'object' ? item.json : null;
    if (Array.isArray(json)) {
      out.push(...json.filter((row) => row && typeof row === 'object'));
      continue;
    }
    if (json && Array.isArray(json.data)) {
      out.push(...json.data.filter((row) => row && typeof row === 'object'));
      continue;
    }
    if (json && typeof json === 'object') {
      out.push(json);
    }
  }
  return out;
}

function safeItemsAccessor(ctx, nodeName) {
  if (!ctx || typeof ctx.$items !== 'function') return [];
  try {
    const rows = ctx.$items(nodeName, 0, 0);
    return Array.isArray(rows) ? rows : [];
  } catch (_err) {
    return [];
  }
}

function buildProjectMaps(projectRows) {
  const allowed = new Map();
  const byId = new Map();

  for (const project of projectRows) {
    const projectId = asText(project.id);
    const projectName = asText(project.name);
    if (!projectId || !projectName) continue;
    const projectKey = ALLOWED_PROJECTS[lower(projectName)] || null;
    byId.set(projectId, {
      todoist_project_id: projectId,
      todoist_project_name: projectName,
      project_key: projectKey,
    });
    if (projectKey) {
      allowed.set(projectId, {
        todoist_project_id: projectId,
        todoist_project_name: projectName,
        project_key: projectKey,
      });
    }
  }

  return { allowed, byId };
}

function buildSectionMap(sectionRows, allowedProjects) {
  const sections = new Map();
  for (const section of sectionRows) {
    const projectId = asText(section.project_id);
    if (!projectId || !allowedProjects.has(projectId)) continue;
    const sectionId = asText(section.id);
    if (!sectionId) continue;
    sections.set(sectionId, {
      todoist_section_id: sectionId,
      todoist_section_name: asText(section.name) || null,
      todoist_project_id: projectId,
    });
  }
  return sections;
}

function buildSubtaskParentSet(taskRows) {
  const set = new Set();
  const rows = Array.isArray(taskRows) ? taskRows : [];
  for (const task of rows) {
    const parentId = parseParentTaskId(task);
    if (parentId) set.add(parentId);
  }
  return set;
}

function normalizeTask(taskRow, projectMeta, sectionMap, subtaskParentSet) {
  const task = taskRow && typeof taskRow === 'object' ? taskRow : {};
  const todoistTaskId = asText(task.id);
  if (!todoistTaskId) return null;
  const rawTitle = asText(task.content);

  const sectionId = asText(task.section_id) || null;
  const sectionMeta = sectionId ? sectionMap.get(sectionId) : null;

  return {
    id: todoistTaskId,
    todoist_task_id: todoistTaskId,
    project_id: projectMeta.todoist_project_id,
    todoist_project_id: projectMeta.todoist_project_id,
    project_name: projectMeta.todoist_project_name,
    todoist_project_name: projectMeta.todoist_project_name,
    project_key: projectMeta.project_key,
    section_id: sectionMeta ? sectionMeta.todoist_section_id : sectionId,
    todoist_section_id: sectionMeta ? sectionMeta.todoist_section_id : sectionId,
    section_name: sectionMeta ? sectionMeta.todoist_section_name : null,
    todoist_section_name: sectionMeta ? sectionMeta.todoist_section_name : null,
    content: rawTitle,
    raw_title: rawTitle,
    description: asText(task.description) || null,
    raw_description: asText(task.description) || null,
    priority: Number.isFinite(Number(task.priority)) ? Number(task.priority) : 1,
    todoist_priority: Number.isFinite(Number(task.priority)) ? Number(task.priority) : 1,
    due: task.due && typeof task.due === 'object' ? {
      date: asText(task.due.date) || null,
      string: asText(task.due.string) || null,
      is_recurring: task.due.is_recurring === true,
    } : null,
    todoist_due_date: task.due && asText(task.due.date) ? asText(task.due.date) : null,
    todoist_due_string: task.due && asText(task.due.string) ? asText(task.due.string) : null,
    todoist_due_is_recurring: !!(task.due && task.due.is_recurring === true),
    added_at: asText(task.added_at) || null,
    todoist_added_at: asText(task.added_at) || null,
    has_subtasks: subtaskParentSet ? subtaskParentSet.has(todoistTaskId) : false,
    explicit_project_signal: hasExplicitProjectSignal(rawTitle),
  };
}

module.exports = async function run(ctx) {
  const current = (ctx && ctx.$json && typeof ctx.$json === 'object') ? ctx.$json : {};

  const projectRows = flattenNodeJson(safeItemsAccessor(ctx, 'Fetch Todoist Projects'));
  const sectionRows = flattenNodeJson(safeItemsAccessor(ctx, 'Fetch Todoist Sections'));
  const taskRows = flattenNodeJson(safeItemsAccessor(ctx, 'Fetch Todoist Tasks'));

  const { allowed: allowedProjects } = buildProjectMaps(projectRows);
  const sectionMap = buildSectionMap(sectionRows, allowedProjects);

  const scopedTasks = taskRows.filter((task) => {
    const projectId = asText(task.project_id);
    return !!(projectId && allowedProjects.has(projectId));
  });
  const subtaskParentSet = buildSubtaskParentSet(scopedTasks);

  const tasks = [];
  for (const task of scopedTasks) {
    const projectId = asText(task.project_id);
    const normalized = normalizeTask(task, allowedProjects.get(projectId), sectionMap, subtaskParentSet);
    if (normalized) tasks.push(normalized);
  }

  const fetchedAt = new Date().toISOString();
  const runId = asText(current.run_id || current.execution_id || current.workflow_run_id) || null;

  return [{
    json: {
      ...current,
      run_id: runId,
      fetched_at: fetchedAt,
      tasks,
      sync_meta: {
        fetched_at: fetchedAt,
        fetched_task_count: taskRows.length,
        filtered_task_count: tasks.length,
        allowed_project_ids: Array.from(allowedProjects.keys()),
      },
    },
  }];
};
