import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";

export default function MyProfile() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/me/profile").then((r) => setProfile(r.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!profile) return <Loading />;

  const isExternal = profile.type === "external";

  return (
    <div>
      <div className="page-header"><h2>HR Details</h2></div>
      <div className="card">
        <div className="toolbar"><StatusBadge status={profile.status} /></div>
        <table>
          <tbody>
            <tr><td>Name</td><td>{profile.name}</td></tr>
            <tr><td>User ID</td><td>{profile.userId}</td></tr>
            {!isExternal && <tr><td>Employee ID</td><td>{profile.employeeId || "-"}</td></tr>}
            {!isExternal && <tr><td>Designation</td><td>{profile.designation || "-"}</td></tr>}
            {!isExternal && <tr><td>Department</td><td>{profile.department || "-"}</td></tr>}
            {!isExternal && <tr><td>Date of Joining</td><td>{profile.dateOfJoining || "-"}</td></tr>}
            <tr><td>Email</td><td>{profile.email || "-"}</td></tr>
            <tr><td>Phone</td><td>{profile.phone || "-"}</td></tr>
            <tr><td>ESI Number</td><td>{profile.esiNumber || "-"}</td></tr>
            <tr><td>UAN</td><td>{profile.uan || "-"}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
