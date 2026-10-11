// Least-privilege check for the Transfer System database user, from MongoDB's connectionStatus
// (showPrivileges). The user may only hold privileges on the transfer database: no cluster-wide or
// any-database privileges, and nothing on the Business Platform database.
const evaluatePrivileges = (status = {}, { transfersDb, businessDb, nodeEnv = "development" } = {}) => {
  const authInfo = status.authInfo || {};
  const users = authInfo.authenticatedUsers || [];
  const problems = [];
  const warnings = [];

  if (!users.length) {
    const message = "Transfer database connection is not authenticated, so access is not restricted by the server";
    if (nodeEnv === "production") problems.push(message);
    else warnings.push(message);
    return { ok: problems.length === 0, problems, warnings, users: [] };
  }

  for (const role of authInfo.authenticatedUserRoles || []) {
    if (role.db !== transfersDb) problems.push(`role ${role.role}@${role.db} is outside ${transfersDb}`);
  }
  for (const privilege of authInfo.authenticatedUserPrivileges || []) {
    const resource = privilege.resource || {};
    if (resource.cluster || resource.anyResource) {
      problems.push(`cluster-wide privilege: ${(privilege.actions || []).join(",")}`);
    } else if (resource.db !== transfersDb) {
      problems.push(`privilege on database "${resource.db || "*"}"`);
    }
    if (businessDb && resource.db === businessDb) problems.push(`privilege on the Business Platform database ${businessDb}`);
  }

  return { ok: problems.length === 0, problems: [...new Set(problems)], warnings, users: users.map((user) => `${user.user}@${user.db}`) };
};

module.exports = { evaluatePrivileges };
