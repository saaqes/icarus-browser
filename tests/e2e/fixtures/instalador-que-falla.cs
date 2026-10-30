// Instalador de prueba para CI (nunca se publica): simula una actualización que falla a
// medias. Espera a que ICARUS se cierre, borra app.asar de la instalación y termina con
// error, como un instalador interrumpido. El proceso auxiliar de ICARUS debe detectarlo y
// restaurar la copia de la versión instalada (tests/e2e/update-packaged.mjs --expect-failure).
using System;
using System.IO;
using System.Threading;

static class InstaladorQueFalla
{
    static int Main(string[] args)
    {
        Thread.Sleep(5000);
        string dir = Environment.GetEnvironmentVariable("ICARUS_UPDATE_APPDIR");
        if (!string.IsNullOrEmpty(dir))
        {
            string asar = Path.Combine(dir, "resources", "app.asar");
            for (int i = 0; i < 20 && File.Exists(asar); i++)
            {
                try { File.Delete(asar); }
                catch (IOException) { Thread.Sleep(500); }
                catch (UnauthorizedAccessException) { Thread.Sleep(500); }
            }
        }
        return 1;
    }
}
