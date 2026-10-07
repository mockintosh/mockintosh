/* wasi-libc's ioctl, plus the terminal's window size (TIOCGWINSZ). */
#ifndef MOCKINTOSH_SYS_IOCTL_H
#define MOCKINTOSH_SYS_IOCTL_H
#include_next <sys/ioctl.h>

struct winsize {
  unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel;
};
#define TIOCGWINSZ 0x5413

int mockintosh_ioctl(int fd, int request, ...);
#define ioctl mockintosh_ioctl
#endif
