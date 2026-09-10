self.addEventListener("install", function (event) {
    self.skipWaiting();
});

self.addEventListener("activate", function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
    let data = {
        title: "MindWatch daily check-in",
        body: "Ready for your daily check-in? A quick 2-minute assessment " +
              "helps you understand how you're feeling today."
    };
    try {
        if (event.data) { data = event.data.json(); }
    } catch (e) { /* ignore */ }

    event.waitUntil(
        self.registration.showNotification(
            data.title || "MindWatch daily check-in",
            {
                body: data.body || "",
                tag: "mindwatch-reminder",
                renotify: true
            }
        )
    );
});

self.addEventListener("notificationclick", function (event) {
    event.notification.close();

    const url = "/dashboard";

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true })
            .then(function (windowClients) {
                for (let i = 0; i < windowClients.length; i++) {
                    const client = windowClients[i];
                    if (client.navigate) {
                        return client.navigate(url).then(function () {
                            return client.focus();
                        });
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});