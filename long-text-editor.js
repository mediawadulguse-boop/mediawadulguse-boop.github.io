/* Keep the form value as text so autosave, imports, and existing storage can share it. */
const LongTextEditor = (() => {
  let nextId = 0;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);

  function emphasis(text) {
    return escape(text)
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  }

  function safeLink(value) {
    if (!/^https?:\/\//i.test(value)) return '';
    try {
      const url = new URL(value);
      return url.hostname && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function inline(text) {
    let output = '', end = 0;
    for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^\s)]+)\)/g)) {
      const url = safeLink(match[2]);
      output += emphasis(text.slice(end, match.index));
      output += url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${emphasis(match[1])}</a>` : escape(match[0]);
      end = match.index + match[0].length;
    }
    return output + emphasis(text.slice(end));
  }

  function render(value) {
    let output = '', list = '';
    for (const line of String(value ?? '').split(/\r\n|\r|\n/)) {
      const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      const number = line.match(/^\s*(\d{1,6})[.)]\s+(.+)$/);
      const type = bullet ? 'ul' : number ? 'ol' : '';
      if (type !== list) {
        if (list) output += `</${list}>`;
        if (type) output += `<${type}>`;
        list = type;
      }
      if (bullet) output += `<li>${inline(bullet[1])}</li>`;
      else if (number) output += `<li value="${Number(number[1])}">${inline(number[2])}</li>`;
      else output += `<div>${line ? inline(line) : '<br>'}</div>`;
    }
    if (list) output += `</${list}>`;
    return `<div class="long-text-content">${output}</div>`;
  }

  function mount(field) {
    if (!field || field.closest('.long-text-editor')) return;
    const doc = field.ownerDocument;
    const label = field.previousElementSibling;
    const editor = doc.createElement('div');
    editor.className = 'long-text-editor';
    const toolbar = doc.createElement('div');
    toolbar.className = 'long-text-toolbar';
    toolbar.setAttribute('role','group');
    toolbar.setAttribute('aria-label','Format teks');
    const preview = doc.createElement('div');
    preview.className = 'long-text-preview';
    preview.hidden = true;
    preview.id = `long-text-preview-${++nextId}`;
    const message = doc.createElement('div');
    message.className = 'long-text-message';
    message.setAttribute('role','status');
    message.hidden = true;
    if (label?.tagName === 'LABEL') {
      field.id ||= `long-text-field-${nextId}`;
      label.htmlFor = field.id;
    }
    field.before(editor);
    editor.append(toolbar, field, message, preview);

    const refresh = () => {
      message.hidden = true;
      if (!preview.hidden) preview.innerHTML = render(field.value || 'Belum ada teks.');
    };
    field.addEventListener('input', refresh);
    field.form?.addEventListener('change', refresh);

    function replace(from, to, value, start = 0, end = value.length) {
      if (field.disabled || field.readOnly) return;
      if (field.maxLength >= 0 && field.value.length - (to - from) + value.length > field.maxLength) {
        message.textContent = `Maksimal ${field.maxLength.toLocaleString('id-ID')} karakter.`;
        message.hidden = false;
        return;
      }
      field.setRangeText(value, from, to);
      field.focus();
      field.setSelectionRange(from + start, from + end);
      field.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));
    }

    function wrap(mark, placeholder) {
      const {selectionStart:from, selectionEnd:to, value} = field;
      const selected = value.slice(from,to);
      if (selected && value.slice(Math.max(0,from-mark.length),from) === mark && value.slice(to,to+mark.length) === mark) {
        replace(from-mark.length,to+mark.length,selected);
        return;
      }
      const text = selected || placeholder;
      if (text.includes('\n')) {
        replace(from,to,text.split('\n').map(line => line.trim() ? mark+line+mark : line).join('\n'));
        return;
      }
      replace(from,to,mark+text+mark,mark.length,mark.length+text.length);
    }

    function makeList(ordered) {
      const {selectionStart, selectionEnd, value} = field;
      const from = value.slice(0,selectionStart).lastIndexOf('\n') + 1;
      const last = selectionEnd > selectionStart && value[selectionEnd-1] === '\n' ? selectionEnd-1 : selectionEnd;
      const next = value.indexOf('\n',last);
      const to = next === -1 ? value.length : next;
      const lines = value.slice(from,to).split('\n');
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/;
      const already = lines.some(line => line.trim()) && lines.every(line => !line.trim() || marker.test(line));
      let number = 0;
      replace(from,to,lines.map(line => {
        if (!line.trim() && lines.length > 1) return line;
        const body = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/,'').trim();
        if (already) return body;
        return (ordered ? `${++number}. ` : '- ') + (body || 'Tulis poin');
      }).join('\n'));
    }

    function button(text, title, action) {
      const el = doc.createElement('button');
      el.type = 'button';
      el.className = 'btn btn-sm long-text-action';
      el.textContent = text;
      el.title = title;
      el.setAttribute('aria-label',title);
      el.addEventListener('mousedown',event => event.preventDefault());
      el.addEventListener('click',action);
      toolbar.append(el);
      return el;
    }

    button('B','Tebal',() => wrap('**','Teks tebal')).classList.add('long-text-bold');
    button('I','Miring',() => wrap('*','Teks miring')).classList.add('long-text-italic');
    button('• Daftar','Daftar poin',() => makeList(false));
    button('1. Daftar','Daftar nomor',() => makeList(true));
    button('Tautan','Sisipkan tautan',() => {
      const {selectionStart:from,selectionEnd:to,value} = field;
      const label = (value.slice(from,to) || 'Teks tautan').replace(/[\[\]\n]/g,' ').trim();
      const url = 'https://';
      replace(from,to,`[${label}](${url})`,label.length+3,label.length+3+url.length);
    });
    const toggle = button('Pratinjau','Pratinjau format',() => {
      preview.hidden = !preview.hidden;
      toggle.setAttribute('aria-expanded',String(!preview.hidden));
      refresh();
    });
    toggle.classList.add('long-text-preview-toggle');
    toggle.setAttribute('aria-controls',preview.id);
    toggle.setAttribute('aria-expanded','false');
    field.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing) return;
      if (!['b','i'].includes(event.key.toLowerCase())) return;
      event.preventDefault();
      if (event.key.toLowerCase() === 'b') wrap('**','Teks tebal');
      else wrap('*','Teks miring');
    });
  }

  function mountAll(root) {
    root.querySelectorAll('textarea[data-text-editor]').forEach(mount);
  }

  return {mount, mountAll, render};
})();
