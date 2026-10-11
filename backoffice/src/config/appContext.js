// The admin pages run in two apps: the Back Office and, as a fallback, the website's /admin. The Back Office
// entry point marks itself so links to customer pages can open the website instead of an in-app route.
let runningInBackOffice = false;

export const markRunningInBackOffice = () => {
  runningInBackOffice = true;
};

export const isRunningInBackOffice = () => runningInBackOffice;
