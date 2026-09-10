// cli-router test fixture — throws the crafted refusal a scaffold guard throws,
// proving a refused command prints its message and nothing else
module.exports = async () => {
  const error = new Error('omega: refusing to scaffold into /tmp/root — it declares "workspaces".\nRun the verb from inside a target.');
  error.refusal = true;
  throw error;
};
