(function () {
  'use strict';

  const el = (tag, text) => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };

  // Copy the install command.
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.dataset.done = '';
        button.textContent = 'Copied';
        setTimeout(() => {
          delete button.dataset.done;
          button.textContent = 'Copy';
        }, 2000);
      } catch {
        button.textContent = 'Select the command to copy it';
      }
    });
  }

  // The marker draws the arrows once and the notes settle. Everything is visible without this.
  const sketch = document.querySelector('.sketch');
  if (sketch && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sketch.querySelectorAll('.stroke').forEach((path, i) => {
      path.setAttribute('pathLength', '1');
      path.style.setProperty('--i', String(i));
    });
    sketch.querySelectorAll('.sticky').forEach((note, i) => note.style.setProperty('--i', String(i)));
    requestAnimationFrame(() => sketch.classList.add('play'));
  }

  // Two editions and the export dialog, fed by the live board.
  const frame = document.querySelector('iframe.demo');
  const dialog = document.querySelector('.export-dialog');
  const ROOTS = { claude: '.claude', copilot: '.github' };
  const KIND = { agent: 'Agent', skill: 'Skill', workflow: 'Workflow' };
  let lastKey = '';
  let lastFocus = '';

  // The selected agent or skill's file; otherwise the first agent, then the workflow.
  function fileFor(model, nodeId, target) {
    const X = window.SkillCanvasExport;
    if (!X) return null;
    const { files } = X.buildExport(model, 'loop-example', target);
    return (
      (nodeId && files.find((f) => f.nodeId === nodeId)) ||
      files.find((f) => f.kind === 'agent') ||
      files.find((f) => f.kind === 'workflow') ||
      files[0] ||
      null
    );
  }

  function nameOf(path) {
    const parts = path.split('/');
    const last = parts[parts.length - 1];
    return last === 'SKILL.md' ? parts[parts.length - 2] : last.replace(/\.agent\.md$|\.md$/, '');
  }

  function paint(sheet, file, target, moved) {
    const tape = sheet.querySelector('.tape');
    const pre = sheet.querySelector('pre');
    if (!file) {
      tape.replaceChildren(el('b', 'Empty'), el('span', 'no agents or skills yet'));
      pre.textContent = 'Add an Agent or Skill block on the board to see its file here.';
      return;
    }
    tape.replaceChildren(el('b', KIND[file.kind] || 'File'), el('span', nameOf(file.path)), el('code', `${ROOTS[target]}/${file.path}`));
    pre.textContent = file.content.trimEnd();
    if (moved) {
      sheet.classList.remove('reprint');
      void sheet.offsetWidth;
      sheet.classList.add('reprint');
    }
  }

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    const msg = event.data || {};
    if (msg.type === 'skillcanvas:model') {
      const key = JSON.stringify([msg.model, msg.nodeId]);
      if (key === lastKey) return;
      lastKey = key;
      const focus = `${msg.nodeId}`;
      const moved = focus !== lastFocus;
      lastFocus = focus;
      for (const sheet of document.querySelectorAll('[data-edition]')) {
        const target = sheet.dataset.edition;
        paint(sheet, fileFor(msg.model, msg.nodeId, target), target, moved);
      }
    } else if (msg.type === 'skillcanvas:export' && dialog) {
      dialog.querySelector('.export-files').replaceChildren(...msg.files.map((path) => el('li', path)));
      dialog.querySelector('.export-next').textContent = msg.command
        ? `Then you'd run ${msg.command} in ${msg.label} chat.`
        : `${msg.label} could use them right away.`;
      dialog.showModal();
    }
  });
})();
