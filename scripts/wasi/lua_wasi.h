/* Lua on WASI: no tmpnam, no system(); temporary names live in /tmp. */
#include <string.h>
#define LUA_TMPNAMBUFSIZE 32
#define lua_tmpnam(b, e) { static unsigned n; snprintf(b, LUA_TMPNAMBUFSIZE, "/tmp/lua_%u", ++n); e = 0; }
#define l_system(cmd) ((cmd) == NULL ? 0 : -1)
/* io.tmpfile: a file in /tmp, opened for update. */
static inline FILE *lua_wasi_tmpfile(void) {
  static unsigned n;
  char name[32];
  snprintf(name, sizeof name, "/tmp/lua_tmp_%u", ++n);
  return fopen(name, "w+");
}
#define tmpfile lua_wasi_tmpfile
