import logging

from manage import main


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main(['maintenance']))
