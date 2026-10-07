/* termios and TIOCGWINSZ through the terminal's `mockintosh_tty` imports. */
#include <errno.h>
#include <stdarg.h>
#include <unistd.h>
#include <termios.h>
#include <sys/ioctl.h>
#undef ioctl

__attribute__((import_module("mockintosh_tty"), import_name("set_mode")))
int __mockintosh_set_mode(int raw, int vmin, int vtime);
__attribute__((import_module("mockintosh_tty"), import_name("get_size")))
int __mockintosh_get_size(unsigned *cols, unsigned *rows);

static struct termios current = {
  .c_iflag = ICRNL | IXON,
  .c_oflag = OPOST | ONLCR,
  .c_cflag = CS8,
  .c_lflag = ISIG | ICANON | ECHO | ECHOE | IEXTEN,
  .c_cc = { [VINTR] = 3, [VQUIT] = 28, [VERASE] = 127, [VKILL] = 21, [VEOF] = 4, [VMIN] = 1 },
};

int tcgetattr(int fd, struct termios *t) {
  if (!isatty(fd)) { errno = ENOTTY; return -1; }
  *t = current;
  return 0;
}

int tcsetattr(int fd, int action, const struct termios *t) {
  (void)action;
  if (!isatty(fd)) { errno = ENOTTY; return -1; }
  current = *t;
  int raw = !(t->c_lflag & ICANON);
  int err = __mockintosh_set_mode(raw, t->c_cc[VMIN], t->c_cc[VTIME]);
  if (err) { errno = err; return -1; }
  return 0;
}

void cfmakeraw(struct termios *t) {
  t->c_iflag &= ~(IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON);
  t->c_oflag &= ~OPOST;
  t->c_lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
  t->c_cflag = (t->c_cflag & ~(CSIZE | PARENB)) | CS8;
  t->c_cc[VMIN] = 1;
  t->c_cc[VTIME] = 0;
}

speed_t cfgetospeed(const struct termios *t) { (void)t; return 38400; }
speed_t cfgetispeed(const struct termios *t) { (void)t; return 38400; }

int mockintosh_ioctl(int fd, int request, ...) {
  if (request == TIOCGWINSZ) {
    va_list ap;
    va_start(ap, request);
    struct winsize *ws = va_arg(ap, struct winsize *);
    va_end(ap);
    unsigned cols = 0, rows = 0;
    if (!isatty(fd) || __mockintosh_get_size(&cols, &rows)) { errno = ENOTTY; return -1; }
    ws->ws_col = cols;
    ws->ws_row = rows;
    ws->ws_xpixel = cols * 6;
    ws->ws_ypixel = rows * 11;
    return 0;
  }
  errno = ENOTTY;
  return -1;
}

/*
 * Start in the shell's working directory. WASI has no inherited cwd; the
 * terminal passes it as PWD, and wasi-libc's chdir makes relative paths
 * resolve from it.
 */
#include <stdlib.h>
__attribute__((constructor)) static void mockintosh_enter_pwd(void) {
  const char *pwd = getenv("PWD");
  if (pwd && pwd[0] == '/') chdir(pwd);
}
