const worker = new Worker(
  new URL("./read_check_granular_worker.js", import.meta.url).href,
  {
    type: "module",
    //TODO(Soremwar)
    //deno-lint-ignore ban-ts-comment
    //@ts-ignore
    deno: {
      namespace: true,
      permissions: {
        read: [],
      },
    },
  },
);

onmessage = async ({ data }) => {
  const path = new URL(data.route, import.meta.url);
  const { state } = await Deno.permissions.query({
    name: "read",
    path,
  });

  worker.onmessage = ({ data: childResponse }) => {
    postMessage({
      childHasPermission: childResponse.hasPermission,
      index: data.index,
      parentHasPermission: state === "granted",
    });
  };

  worker.postMessage({
    index: 0, // Ignore index in this test
    route: data.route,
  });
};
