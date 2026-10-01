// Records what the factory and setup received into the `record` factory argument.
module.exports = (factoryArgs) => {
  factoryArgs.record.push({ step: 'factory', keys: Object.keys(factoryArgs).sort(), projectRoot: factoryArgs.projectRoot, flavor: factoryArgs.flavor });
  return {
    async setup(ctx) {
      factoryArgs.record.push({ step: 'setup', keys: Object.keys(ctx).sort(), projectRoot: ctx.projectRoot, emulator: ctx.emulator });
    },
  };
};
