import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button, Dropdown } from "react-bootstrap";
import { useAuth } from "../auth/AuthContext";
import { navigationFor, roleLabel } from "../lib/permissions";
import ChangePasswordModal from "../pages/ChangePasswordModal";

const AdminLayout = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const items = navigationFor(user);

  return (
    <div className={`ta-shell ${open ? "is-nav-open" : ""}`}>
      <aside className="ta-sidebar" aria-label="Transfer Admin navigation">
        <div className="ta-brand">
          <span className="ta-brand-mark" aria-hidden="true">T</span>
          <div>
            <strong>Transfer Admin</strong>
            <span>Riser Transfers</span>
          </div>
        </div>
        <nav>
          {items.map((item) =>
            item.section ? (
              <div key={item.section} className="ta-nav-section">{item.section}</div>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end || item.to === "/bookings"} className="ta-nav-link" onClick={() => setOpen(false)}>
                {item.label}
              </NavLink>
            )
          )}
        </nav>
      </aside>
      {open ? <button type="button" className="ta-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}

      <div className="ta-main">
        <header className="ta-topbar">
          <Button variant="outline-secondary" size="sm" className="ta-menu-button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}>
            ☰
          </Button>
          <span className="ta-topbar-path" aria-hidden="true">{location.pathname}</span>
          <Dropdown align="end">
            <Dropdown.Toggle variant="light" size="sm" id="ta-user-menu">
              {user.name} · {roleLabel(user.role)}
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.ItemText className="small text-muted">{user.email}</Dropdown.ItemText>
              <Dropdown.Item as="button" onClick={() => setChangingPassword(true)}>Change password</Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item as="button" onClick={() => logout()}>Sign out</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </header>
        <main className="ta-content">
          <Outlet />
        </main>
      </div>
      <ChangePasswordModal show={changingPassword} onHide={() => setChangingPassword(false)} />
    </div>
  );
};

export default AdminLayout;
