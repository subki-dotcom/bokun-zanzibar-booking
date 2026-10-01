import { useEffect, useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { cookieConsent, initializeConsent } from '../../utils/consent';
import './cookieConsent.css';

export default function CookieConsent({ store = cookieConsent }) {
  const [choice, setChoice] = useState(() => store.get());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ analytics: false, advertising: false });
  const [notice, setNotice] = useState('');
  const manage = () => {
    const current = store.get();
    setDraft({ analytics: current?.analytics === true, advertising: current?.advertising === true });
    setOpen(true);
  };
  useEffect(() => {
    const unsubscribe = store.subscribe(() => setChoice(store.get()));
    if (store === cookieConsent) initializeConsent();
    setChoice(store.get());
    const show = () => {
      const current = store.get();
      setDraft({ analytics: current?.analytics === true, advertising: current?.advertising === true });
      setOpen(true);
    };
    window.addEventListener('riser:open-cookie-preferences', show);
    return () => { unsubscribe(); window.removeEventListener('riser:open-cookie-preferences', show); };
  }, [store]);
  const save = (value) => {
    const persisted = store.save(value);
    setNotice(persisted ? '' : 'Your choice applies to this visit. Your browser could not save it for future visits.');
    setOpen(false);
  };
  const actions = <>
    <Button variant="outline-dark" onClick={() => save({ analytics: true, advertising: true })}>Accept All</Button>
    <Button variant="outline-dark" onClick={() => save({ analytics: false, advertising: false })}>Reject Optional</Button>
  </>;
  return <>
    {!choice && <section className="cookie-consent-banner" aria-labelledby="cookie-banner-title">
      <div className="cookie-consent-copy">
        <h2 id="cookie-banner-title">Your cookie choices</h2>
        <p>Necessary storage keeps bookings and sign-in working. With your permission, we use optional analytics to understand visits and bookings, and advertising cookies to measure and personalize ads. You can book without accepting optional cookies.</p>
        <Link to="/privacy">Read our Privacy Policy</Link>
      </div>
      <div className="cookie-consent-actions">{actions}<Button variant="outline-dark" onClick={manage}>Manage Preferences</Button></div>
    </section>}
    {notice && <p className="cookie-consent-notice" role="status">{notice}</p>}
    <Modal show={open} onHide={() => setOpen(false)} aria-labelledby="cookie-preferences-title" centered scrollable restoreFocus>
      <Modal.Header closeButton><Modal.Title id="cookie-preferences-title">Cookie Preferences</Modal.Title></Modal.Header>
      <Modal.Body className="cookie-consent-preferences">
        <p>Choose optional categories. You can change your choice at any time using Cookie Preferences in the footer.</p>
        <Form.Check id="consent-necessary" type="switch" label="Necessary — always on" checked disabled />
        <p>Required for security, sign-in, your booking session and remembering this choice.</p>
        <Form.Check id="consent-analytics" type="switch" label="Analytics" checked={draft.analytics}
          onChange={(event) => setDraft((current) => ({ ...current, analytics: event.target.checked }))} />
        <p>Allow Google Analytics to measure site visits, tour interest and completed bookings.</p>
        <Form.Check id="consent-advertising" type="switch" label="Advertising" checked={draft.advertising}
          onChange={(event) => setDraft((current) => ({ ...current, advertising: event.target.checked }))} />
        <p>Allow advertising storage, advertising measurement data and personalized ads when configured. Booking conversion measurement also needs Analytics.</p>
        <Link to="/privacy" onClick={() => setOpen(false)}>Read our Privacy Policy</Link>
      </Modal.Body>
      <Modal.Footer className="cookie-consent-actions">{actions}<Button variant="dark" onClick={() => save(draft)}>Save Preferences</Button></Modal.Footer>
    </Modal>
  </>;
}
