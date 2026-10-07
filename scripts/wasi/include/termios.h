/*
 * termios for WebAssembly programs on a Mockintosh terminal. WASI has no
 * terminal control; this is the part of POSIX's that editors and line
 * readers use, carried out by the terminal through the `mockintosh_tty`
 * imports (see mactty.c and packages/terminal/src/wasi/host.ts).
 */
#ifndef MOCKINTOSH_TERMIOS_H
#define MOCKINTOSH_TERMIOS_H

typedef unsigned int tcflag_t;
typedef unsigned char cc_t;
typedef unsigned int speed_t;

#define NCCS 32
struct termios {
  tcflag_t c_iflag, c_oflag, c_cflag, c_lflag;
  cc_t c_line;
  cc_t c_cc[NCCS];
  speed_t c_ispeed, c_ospeed;
};

/* c_iflag */
#define IGNBRK 0000001
#define BRKINT 0000002
#define IGNPAR 0000004
#define PARMRK 0000010
#define INPCK 0000020
#define ISTRIP 0000040
#define INLCR 0000100
#define IGNCR 0000200
#define ICRNL 0000400
#define IXON 0002000
#define IXOFF 0010000
/* c_oflag */
#define OPOST 0000001
#define ONLCR 0000004
/* c_cflag */
#define CSIZE 0000060
#define CS8 0000060
#define PARENB 0000400
/* c_lflag */
#define ISIG 0000001
#define ICANON 0000002
#define ECHO 0000010
#define ECHOE 0000020
#define ECHOK 0000040
#define ECHONL 0000100
#define IEXTEN 0100000
/* c_cc */
#define VINTR 0
#define VQUIT 1
#define VERASE 2
#define VKILL 3
#define VEOF 4
#define VTIME 5
#define VMIN 6
#define VSUSP 10
/* tcsetattr */
#define TCSANOW 0
#define TCSADRAIN 1
#define TCSAFLUSH 2

int tcgetattr(int fd, struct termios *t);
int tcsetattr(int fd, int action, const struct termios *t);
void cfmakeraw(struct termios *t);
speed_t cfgetospeed(const struct termios *t);
speed_t cfgetispeed(const struct termios *t);

#endif
