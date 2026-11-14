/* Living Forest forms. No tracking credentials belong in this browser file. */
(function () {
  'use strict';
  const id = () => crypto.randomUUID();
  const pixel = (name, eventId, custom) => {
    try { if (window.fbq) window.fbq(custom ? 'trackSingleCustom' : 'trackSingle', '1468969448526553', name,
      { content_name: window.LEADS_PROJECT }, { eventID: eventId }); } catch (_) { /* Tracking never blocks a form. */ }
  };
  const questions = [
    ['config', 'Configuration', ['3 BHK', '3.5 BHK', 'Open to both']],
    ['budget', 'Budget', ['Under Rs 2 Cr', 'Rs 2–2.5 Cr', 'Rs 2.5–3 Cr', 'Rs 3 Cr+']]
  ];
  const qualifies = d => questions[1][2].slice(1).includes(d.budget);
  const cookie = name => {
    const entry = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
    return entry ? entry.slice(name.length + 1) : '';
  };
  // A normal form POST avoids CORS/preflight. Apps Script returns a sandboxed HTML
  // acknowledgement via postMessage; an opaque fetch response cannot confirm a save.
  function save(data) {
    return new Promise((resolve, reject) => {
      const requestId = id(), frame = document.createElement('iframe'), form = document.createElement('form');
      frame.name = 'forest-' + requestId; frame.hidden = true; frame.title = 'Saving enquiry';
      form.method = 'POST'; form.action = window.LEADS_URL; form.target = frame.name; form.hidden = true;
      const input = document.createElement('input'); input.type = 'hidden'; input.name = 'payload';
      input.value = JSON.stringify({ ...data, request_id: requestId, response_origin: location.origin,
        project: window.LEADS_PROJECT, page: location.href, fbp: cookie('_fbp'), fbc: cookie('_fbc'), user_agent: navigator.userAgent });
      form.appendChild(input);
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); form.remove(); frame.remove(); };
      const receive = event => {
        if (!/^https:\/\/([a-z0-9-]+-)?script\.googleusercontent\.com$/.test(event.origin) && event.origin !== 'https://script.google.com') return;
        const r = event.data;
        if (!r || r.type !== 'forest-lead-result' || r.request_id !== requestId) return;
        cleanup(); r.ok ? resolve(r) : reject(new Error(r.error || 'Could not save. Please try again.'));
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Save confirmation took too long. Please retry; your details may already be saved.')); }, 60000);
      window.addEventListener('message', receive); document.body.append(frame, form); form.submit();
    });
  }
  const e = React.createElement;
  const buttonStyle = { background: '#1c1c1b', color: '#fafaf9', border: 'none', padding: '16px 28px', fontSize: 14, letterSpacing: '.08em', cursor: 'pointer' };
  class EnquiryForm extends React.Component {
    constructor(props) {
      super(props);
      this.state = { done: false, name: '', phone: props.initialPhone || '', answers: {}, whatsapp_opt_in: true, busy: false, error: '' };
      this.leadId = id(); this.leadEvent = id(); this.qualifiedEvent = id();
    }
    async submit(event) {
      event.preventDefault();
      if (this.pending) return;
      const s = this.state;
      if (!s.name.trim() || !/^[6-9]\d{9}$/.test(s.phone)) {
        this.setState({ error: 'Enter your name and a valid 10-digit Indian mobile number.' }); return;
      }
      if (questions.some(([key]) => !s.answers[key])) {
        this.setState({ error: 'Choose a configuration and a budget.' }); return;
      }
      // A retry keeps its IDs; edited details become a new request.
      const attempt = JSON.stringify([s.name.trim(), s.phone, s.answers]);
      if (this.attempt && this.attempt !== attempt) { this.leadId = id(); this.leadEvent = id(); this.qualifiedEvent = id(); }
      this.attempt = attempt;
      this.pending = true; this.setState({ busy: true, error: '' });
      try {
        const result = await save({ action: 'capture', lead_id: this.leadId, event_id: this.leadEvent, qualified_event_id: this.qualifiedEvent,
          form: this.props.form, name: s.name.trim(), phone: s.phone, email: '', config: '', message: '', location: '', budget: '', timeline: '', visit: '', ...s.answers, whatsapp_opt_in: s.whatsapp_opt_in });
        this.leadId = result.lead_id;
        if (result.track_lead) pixel('Lead', result.event_id);
        if (result.track_qualified && qualifies(s.answers)) pixel('QualifiedLead', result.qualified_event_id, true);
        this.setState({ done: true });
      } catch (err) { this.setState({ error: err.message }); }
      finally { this.pending = false; this.setState({ busy: false }); }
    }
    render() {
      const s = this.state, prefix = 'enquiry-' + this.leadEvent;
      if (s.done) return e('div', { role: 'status', style: { fontSize: 18, lineHeight: 1.6 } },
        e('p', null, 'Thank you. Our team will be in touch shortly.'),
        this.props.onClose && e('button', { type: 'button', style: buttonStyle, onClick: this.props.onClose }, 'Close'));
      return e('form', { onSubmit: ev => this.submit(ev), noValidate: true, style: { display: 'grid', gridTemplateColumns: this.props.wide ? 'repeat(auto-fit,minmax(min(100%,240px),1fr))' : '1fr', gap: 24, textAlign: 'left' } },
        e('p', { role: 'status', style: { gridColumn: '1/-1', margin: 0, color: '#4f4f4c', lineHeight: 1.6 } }, 'Register your interest for free.'),
        ['name', 'phone'].map(key => e('label', { key, htmlFor: prefix + key, style: { display: 'grid', gap: 8, fontSize: 13, letterSpacing: '.08em' } },
          key === 'name' ? 'Full name' : 'Mobile (+91)', e('input', { id: prefix + key, name: key, required: true,
            autoComplete: key === 'name' ? 'name' : 'tel-national', type: key === 'name' ? 'text' : 'tel',
            inputMode: key === 'phone' ? 'numeric' : undefined, maxLength: key === 'phone' ? 10 : 120,
            value: s[key], disabled: s.busy, onChange: ev => this.setState({ [key]: key === 'phone' ? ev.target.value.replace(/\D/g, '') : ev.target.value }),
            style: { width: '100%', boxSizing: 'border-box', padding: '12px 0', border: 'none', borderBottom: '1px solid #8a8a86', background: 'transparent', fontSize: 18, color: '#1c1c1b' } }))),
        questions.map(([key, label, options]) => e('fieldset', { key, disabled: s.busy, style: { gridColumn: '1/-1', border: 0, padding: 0, margin: 0, minWidth: 0 } },
          e('legend', { style: { marginBottom: 10, fontSize: 14 } }, label),
          e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } }, options.map(option => e('label', { key: option,
            style: { display: 'flex', gap: 7, alignItems: 'center', padding: '10px 12px', border: '1px solid ' + (s.answers[key] === option ? '#1c1c1b' : '#c4c4bd'), background: s.answers[key] === option ? '#e6e6e2' : 'transparent', cursor: 'pointer', fontSize: 14 } },
            e('input', { type: 'radio', name: prefix + key, value: option, checked: s.answers[key] === option,
              onChange: () => this.setState({ answers: { ...this.state.answers, [key]: option } }) }), option))))),
        s.error && e('p', { role: 'alert', style: { gridColumn: '1/-1', margin: 0, color: '#a12d22', lineHeight: 1.5 } }, s.error),
        e('button', { type: 'submit', disabled: s.busy, style: { ...buttonStyle, gridColumn: '1/-1', opacity: s.busy ? .6 : 1 } }, s.busy ? 'Saving…' : 'Register free'),
        e('p', { style: { gridColumn: '1/-1', margin: 0, fontSize: 13, color: '#6b6b67', lineHeight: 1.5 } }, 'By registering, you agree to be contacted by call, SMS and WhatsApp about this project.'));
    }
  }
  window.ForestEnquiry = { Form: EnquiryForm, contact: () => pixel('Contact', id()) };
}());
